import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ModuleGuard } from '../license/module.guard';
import { JwtAuthGuard } from './auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { PermissionsGuard } from './permissions.guard';

/**
 * Seguranca global da API. A ORDEM abaixo e a ordem de execucao:
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
    // Entre o Jwt e o Permissions de proposito. "Seu plano nao inclui Fiscal" e
    // uma mensagem que o operador consegue repetir para o suporte; "sem
    // permissao" nao e. E, mais importante: o PermissionsGuard CONSOME o vale
    // de supervisor (uso unico) — deixa-lo rodar antes queimava o vale numa
    // rota que o modulo ia recusar de qualquer jeito, sem deixar trilha.
    { provide: APP_GUARD, useClass: ModuleGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PassportModule],
})
export class CommonModule {}
