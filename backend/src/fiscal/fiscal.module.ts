import { Module } from '@nestjs/common';
import { FiscalContingencyService } from './fiscal-contingency.service';
import { FiscalController } from './fiscal.controller';
import { FiscalNumberingService } from './fiscal-numbering.service';
import { FiscalService } from './fiscal.service';
import { FISCAL_PROVIDER } from './providers/fiscal-provider';
import { FakeFiscalProvider } from './providers/fake-fiscal.provider';

/**
 * Emissao de NFC-e. Hoje o provedor ativo e o simulado (FakeFiscalProvider);
 * a troca por um integrador real (Focus NFe, PlugNotas, ...) e so mudar o
 * `useClass` — nada mais no sistema conhece o provedor concreto.
 *
 * O FiscalNumberingService e exportado porque o SalesService tambem aloca
 * numeracao de contingencia (quando a loja ja esta em contingencia no momento
 * da venda). O FiscalContingencyService e o runner que reconcilia com a SEFAZ.
 */
@Module({
  controllers: [FiscalController],
  providers: [
    FiscalService,
    FiscalNumberingService,
    FiscalContingencyService,
    FakeFiscalProvider,
    { provide: FISCAL_PROVIDER, useExisting: FakeFiscalProvider },
  ],
  exports: [FiscalService, FiscalNumberingService],
})
export class FiscalModule {}
