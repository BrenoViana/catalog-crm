import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { PermissionsGuard } from './permissions.guard';

/**
 * Seguranca global da API:
 * - JwtAuthGuard: toda rota exige um JWT valido, exceto as marcadas com @Public().
 * - PermissionsGuard: quando a rota tem @RequirePermissions(), consulta o
 *   conjunto efetivo do usuario no banco (papel + excecoes individuais).
 * A ordem de registro importa — o JwtAuthGuard roda primeiro e popula req.user.
 */
@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PassportModule],
})
export class CommonModule {}
