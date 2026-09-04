import { Global, Module } from '@nestjs/common';
import { AppSettingsController } from './app-settings.controller';
import { AppSettingsService } from './app-settings.service';

/** Global: guards e servicos de varios modulos leem configuracao. */
@Global()
@Module({
  controllers: [AppSettingsController],
  providers: [AppSettingsService],
  exports: [AppSettingsService],
})
export class AppSettingsModule {}
