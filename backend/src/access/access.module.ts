import { Global, Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';

/**
 * Global porque o PermissionsGuard (registrado no CommonModule como APP_GUARD)
 * depende do AccessService para decidir toda requisicao.
 */
@Global()
@Module({
  controllers: [AccessController],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
