import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsArray, IsDefined, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../common/permissions.decorator';
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
  constructor(private readonly settings: AppSettingsService) {}

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

  @RequirePermissions('settings.manage')
  @Put()
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.updateMany(dto.settings);
  }
}
