import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PaymentsModule } from '../payments/payments.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { TerminalsModule } from '../terminals/terminals.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [
    FiscalModule,
    PaymentsModule,
    PromotionsModule,
    FinanceModule,
    LoyaltyModule,
    TerminalsModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
