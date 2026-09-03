import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';

/**
 * Registra a estrategia JWT e o PassportModule globalmente, para que
 * `JwtAuthGuard` funcione em qualquer modulo sem precisar reimportar o Passport.
 * `register({ defaultStrategy: 'jwt' })` provê o token AuthModuleOptions que o
 * AuthGuard resolve por injecao.
 */
@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  providers: [JwtStrategy],
  exports: [PassportModule],
})
export class CommonModule {}
