import { Module } from '@nestjs/common';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
import { FISCAL_PROVIDER } from './providers/fiscal-provider';
import { FakeFiscalProvider } from './providers/fake-fiscal.provider';

/**
 * Emissao de NFC-e. Hoje o provedor ativo e o simulado (FakeFiscalProvider);
 * a troca por um integrador real (Focus NFe, PlugNotas, ...) e so mudar o
 * `useClass` — nada mais no sistema conhece o provedor concreto.
 */
@Module({
  controllers: [FiscalController],
  providers: [
    FiscalService,
    FakeFiscalProvider,
    { provide: FISCAL_PROVIDER, useExisting: FakeFiscalProvider },
  ],
  exports: [FiscalService],
})
export class FiscalModule {}
