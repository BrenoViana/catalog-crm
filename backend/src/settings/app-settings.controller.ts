import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsArray, IsDefined, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../common/permissions.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthorizationService } from '../access/authorization.service';
import { AppSettingsService } from './app-settings.service';

class SettingEntryDto {
  @IsString()
  key: string;

  // Aceita numero, texto ou booleano — o service valida contra o catalogo.
  // @IsDefined e obrigatorio: sem nenhum decorator, o ValidationPipe com
  // whitelist:true removeria a propriedade do payload.
  @IsDefined()
  value: unknown;
}

class UpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingEntryDto)
  settings: SettingEntryDto[];
}

@Controller('app-settings')
export class AppSettingsController {
  constructor(
    private readonly settings: AppSettingsService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Valores que o PDV precisa para montar a tela; qualquer autenticado le. */
  @Get('public')
  publicValues() {
    return this.settings.publicValues();
  }

  @RequirePermissions('settings.manage')
  @Get()
  list() {
    return this.settings.list();
  }

  /**
   * Configuracao de sistema e superficie de seguranca: daqui se afrouxa o rate
   * limit do login e o da liberacao de supervisor. Toda alteracao vai para a
   * trilha com chave e valor, antes e depois.
   */
  @RequirePermissions('settings.manage')
  @Put()
  async update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const antes = await this.settings.list();
    const anterior = new Map(
      (antes as { key: string; value: unknown }[]).map((s) => [s.key, s.value]),
    );
    const result = await this.settings.updateMany(dto.settings);
    await this.authorization.record({
      action: 'appSettings.update',
      actorId,
      targetType: 'AppSetting',
      detail: {
        mudancas: dto.settings.map((s) => ({
          chave: s.key,
          de: anterior.get(s.key) ?? null,
          para: s.value,
        })),
      },
    });
    return result;
  }
}
