import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

/**
 * `CashService` e exportado porque o fechamento do dia (financeiro) consolida
 * exatamente os mesmos numeros do X/Z. Duplicar a conta la seria a receita para
 * o consolidado e o fechamento discordarem sobre o mesmo dia.
 */
@Module({
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
