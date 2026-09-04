import { SetMetadata } from '@nestjs/common';

/**
 * Exige TODAS as permissoes listadas para acessar a rota.
 * Sem o decorator, basta estar autenticado (o JwtAuthGuard global ja cuida).
 * As chaves saem de src/access/permission-catalog.ts.
 */
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
