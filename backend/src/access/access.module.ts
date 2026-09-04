import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getJwtSecret } from '../common/jwt-secret';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { AuthorizationService } from './authorization.service';

/**
 * Global porque o PermissionsGuard (registrado no CommonModule como APP_GUARD)
 * depende do AccessService e do AuthorizationService para decidir toda
 * requisicao.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: getJwtSecret() }),
    }),
  ],
  controllers: [AccessController],
  providers: [AccessService, AuthorizationService],
  exports: [AccessService, AuthorizationService],
})
export class AccessModule {}
