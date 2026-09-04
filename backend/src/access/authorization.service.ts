import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import { PERMISSION_KEYS } from './permission-catalog';

/**
 * Liberação de supervisor no balcão.
 *
 * O operador esbarra numa permissão que não tem; em vez de trocar de usuário,
 * um supervisor digita as próprias credenciais ali mesmo e o sistema emite um
 * "vale" de curta duração, válido para UMA permissão. O vale viaja no header
 * X-Authorization-Grant da requisição seguinte e o PermissionsGuard o aceita
 * no lugar da permissão faltante.
 *
 * Toda liberação vira linha no AuditLog: quem pediu, quem liberou e para quê.
 */

/** Vale curto — o suficiente para concluir a operação em curso, não mais. */
const GRANT_TTL_SECONDS = 180;

export interface GrantPayload {
  typ: 'grant';
  /** Quem vai USAR o vale (o operador). */
  sub: string;
  /** Quem AUTORIZOU (o supervisor). */
  approver: string;
  permission: string;
  jti: string;
}

@Injectable()
export class AuthorizationService {
  private readonly log = new Logger(AuthorizationService.name);
  /** Vales já gastos — um vale serve para uma operação só. */
  private readonly used = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
  ) {}

  /**
   * Valida as credenciais do supervisor e emite o vale para o operador.
   * Falha se o supervisor não tiver ele próprio a permissão pedida.
   */
  async requestGrant(params: {
    operatorId: string;
    username: string;
    password: string;
    permission: string;
    reason?: string;
  }) {
    const { operatorId, username, password, permission, reason } = params;

    if (!PERMISSION_KEYS.includes(permission)) {
      throw new BadRequestException(`Permissao "${permission}" nao existe.`);
    }

    const approver = await this.prisma.user.findUnique({ where: { username } });
    if (!approver || !approver.active || !bcrypt.compareSync(password, approver.passwordHash)) {
      // Mensagem única: não revela se o usuário existe.
      throw new UnauthorizedException('Credenciais de supervisor invalidas.');
    }
    if (approver.id === operatorId) {
      throw new ForbiddenException('A liberacao precisa vir de outro usuario.');
    }
    if (!(await this.access.can(approver.id, permission))) {
      throw new ForbiddenException(
        `${approver.name} nao tem a permissao necessaria para liberar esta operacao.`,
      );
    }

    const jti = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload: GrantPayload = {
      typ: 'grant',
      sub: operatorId,
      approver: approver.id,
      permission,
      jti,
    };
    const token = this.jwt.sign(payload, { expiresIn: GRANT_TTL_SECONDS });

    await this.record({
      action: 'authorization.grant',
      permissionKey: permission,
      actorId: operatorId,
      approverId: approver.id,
      detail: { reason: reason ?? null, jti },
    });

    return {
      token,
      permission,
      expiresInSeconds: GRANT_TTL_SECONDS,
      approver: { id: approver.id, name: approver.name },
    };
  }

  /**
   * Confere o vale apresentado. Devolve o id do supervisor quando vale;
   * null quando ausente, inválido, de outro usuário/permissão ou já usado.
   */
  consume(token: string | undefined, userId: string, permission: string): string | null {
    if (!token) return null;

    let payload: GrantPayload;
    try {
      payload = this.jwt.verify<GrantPayload>(token);
    } catch {
      return null;
    }

    if (payload.typ !== 'grant') return null;
    if (payload.sub !== userId) return null;
    if (payload.permission !== permission) return null;

    // Uso único: o mesmo vale não libera duas operações.
    const now = Date.now();
    for (const [jti, at] of this.used) {
      if (now - at > GRANT_TTL_SECONDS * 1000) this.used.delete(jti);
    }
    if (this.used.has(payload.jti)) return null;
    this.used.set(payload.jti, now);

    return payload.approver;
  }

  /** Escreve na trilha de auditoria sem nunca derrubar a operação principal. */
  async record(entry: {
    action: string;
    actorId: string;
    permissionKey?: string | null;
    approverId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    detail?: unknown;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          permissionKey: entry.permissionKey ?? null,
          actorId: entry.actorId,
          approverId: entry.approverId ?? null,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          detail: (entry.detail ?? undefined) as never,
        },
      });
    } catch (err) {
      this.log.error(
        `Falha ao gravar auditoria (${entry.action}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  listAudit(params: { action?: string; take?: number }) {
    return this.prisma.auditLog.findMany({
      where: params.action ? { action: params.action } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.take ?? 100, 500),
      include: {
        actor: { select: { id: true, name: true, username: true } },
        approver: { select: { id: true, name: true, username: true } },
      },
    });
  }
}
