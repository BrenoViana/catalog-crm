import { Global, Module } from '@nestjs/common';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseRenewalService } from './license-renewal.service';

/**
 * Global porque o LicenseService e consultado pelo ModuleGuard e pelos services
 * que aplicam regra de negocio de modulo pago (venda: promocao e fiscal).
 *
 * O ModuleGuard NAO e registrado aqui: o Nest ordena os APP_GUARD pela ordem de
 * varredura dos modulos, e registrar neste modulo o colocava DEPOIS do
 * PermissionsGuard — o inverso do que se quer. Ele vive no CommonModule, entre
 * o Jwt e o Permissions.
 */
@Global()
@Module({
  controllers: [LicenseController],
  providers: [LicenseService, LicenseRenewalService],
  exports: [LicenseService, LicenseRenewalService],
})
export class LicenseModule {}
