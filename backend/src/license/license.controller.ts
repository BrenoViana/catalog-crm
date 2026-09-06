import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { AuthorizationService } from '../access/authorization.service';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { LicenseService } from './license.service';
import { LicenseRenewalService } from './license-renewal.service';
import { UpdateLicenseDto } from './dto/update-license.dto';

@Controller()
export class LicenseController {
  constructor(
    private readonly licenseService: LicenseService,
    private readonly renewal: LicenseRenewalService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Estado da licenca e modulos ativos. Qualquer autenticado le: o frontend
   * precisa disto para esconder do menu o que nao esta licenciado, e o operador
   * precisa ver o aviso de vencimento. Nao devolve a chave.
   */
  @Get('license/status')
  status() {
    return this.licenseService.status();
  }

  @RequirePermissions('settings.manage')
  @Get('settings/license')
  getLicense() {
    return this.licenseService.getCurrent();
  }

  /** Trocar a licenca muda o que a loja pode fazer: vai para a trilha. */
  @RequirePermissions('settings.manage')
  @Put('settings/license')
  async update(
    @Body() dto: UpdateLicenseDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const antes = await this.licenseService.status();
    const saved = await this.licenseService.update(dto);
    const depois = await this.licenseService.status();
    await this.authorization.record({
      action: 'license.update',
      actorId,
      targetType: 'License',
      targetId: saved.id,
      detail: {
        cliente: depois.cliente,
        expiraEm: depois.expiraEm,
        de: antes.modulos,
        para: depois.modulos,
      },
    });
    return saved;
  }

  /** Forca uma tentativa de renovacao — util no suporte. */
  @RequirePermissions('settings.manage')
  @Post('settings/license/renovar')
  async renovar(@CurrentUser('userId') actorId: string) {
    const resultado = await this.renewal.tentar();
    await this.authorization.record({
      action: 'license.renew',
      actorId,
      targetType: 'License',
      detail: { resultado },
    });
    return { resultado, status: await this.licenseService.status() };
  }
}
