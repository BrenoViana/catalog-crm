import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from '../access/access.service';
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const userId = request.user?.userId;
    if (!userId) throw new ForbiddenException('Usuario nao identificado.');

    const granted = await this.access.effectivePermissions(userId);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Voce nao tem permissao para esta operacao (${missing.join(', ')}).`,
      );
    }
    return true;
  }
}
