import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Vale de supervisor cru, como veio no header (para checagens no service). */
export const GrantToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const header = ctx.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>().headers?.['x-authorization-grant'];
    return Array.isArray(header) ? header[0] : header;
  },
);

export interface UsedGrant {
  permission: string;
  approverId: string;
}

/**
 * Vale JA consumido pelo PermissionsGuard nesta requisicao — presente quando a
 * rota so passou porque um supervisor liberou. Serve para a trilha de auditoria.
 */
export const UsedAuthorizationGrant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsedGrant | undefined =>
    ctx.switchToHttp().getRequest<{ authorizationGrant?: UsedGrant }>()
      .authorizationGrant,
);
