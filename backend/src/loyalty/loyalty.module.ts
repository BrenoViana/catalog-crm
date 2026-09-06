import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

/**
 * Fidelidade. Exporta o servico porque quem de fato move o saldo e a venda:
 * o acumulo e o resgate acontecem dentro da transacao do PDV, nunca por uma
 * chamada avulsa depois do fato.
 */
@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
