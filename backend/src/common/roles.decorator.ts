import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Restringe a rota aos papeis informados. ADMIN sempre passa.
 * Sem @Roles(), qualquer usuario autenticado acessa.
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
