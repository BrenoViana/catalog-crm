import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from '../access/access.service';
import { AuthorizationService } from '../access/authorization.service';
import type { AuthUser } from './current-user.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';

/**
 * Autorizacao por permissao granular, resolvida no banco (papel do usuario +
 * excecoes individuais). Nao ha papel privilegiado no codigo: quem pode o que
 * e sempre uma consulta ao AccessService.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      headers?: Record<string, string | string[] | undefined>;
      authorizationGrant?: { permission: string; approverId: string };
    }>();
    const userId = request.user?.userId;
    if (!userId) throw new ForbiddenException('Usuario nao identificado.');

    const granted = await this.access.effectivePermissions(userId);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length === 0) return true;

    // Falta permissao: aceita um vale de supervisor emitido para exatamente
    // esta permissao e este operador (uso unico, valido por poucos minutos).
    const header = request.headers?.['x-authorization-grant'];
    const token = Array.isArray(header) ? header[0] : header;
    if (missing.length === 1) {
      const approverId = this.authorization.consume(token, userId, missing[0]);
      if (approverId) {
        // O service da rota le isto para registrar quem liberou.
        request.authorizationGrant = { permission: missing[0], approverId };
        return true;
      }
    }

    throw new ForbiddenException(
      `Voce nao tem permissao para esta operacao (${missing.join(', ')}).`,
    );
  }
}
