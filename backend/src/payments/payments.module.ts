import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CashPaymentProvider } from './providers/cash-payment.provider';
import { FakeElectronicProvider } from './providers/fake-electronic.provider';
import { PAYMENT_GATEWAYS } from './providers/payment-gateway';

/**
 * Porta de pagamento. Hoje os provedores ativos sao o de balcao (dinheiro,
 * crediario, outro) e o eletronico simulado (Pix, debito, credito).
 *
 * Trocar por integrador real e acrescentar a classe e troca-la na lista de
 * PAYMENT_GATEWAYS — a ordem importa: o primeiro que declarar `supports()`
 * para a forma atende. Nada mais no sistema conhece o provedor concreto.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    CashPaymentProvider,
    FakeElectronicProvider,
    {
      provide: PAYMENT_GATEWAYS,
      useFactory: (balcao: CashPaymentProvider, eletronico: FakeElectronicProvider) => {
        // Trava pela positiva: o provedor simulado confirma QUALQUER valor em
        // Pix/cartao. Numa loja real isso e entregar mercadoria sem cobrar.
        // Nao basta checar NODE_ENV !== 'production' — variavel ausente cai em
        // desenvolvimento (SEC-010), entao exigimos permissao explicita.
        const isDev = process.env.NODE_ENV === 'development';
        const allowed = process.env.ALLOW_FAKE_PAYMENT_GATEWAY === 'true';
        if (!isDev && !allowed) {
          throw new Error(
            'Nenhum provedor de pagamento real configurado. O simulado confirma ' +
              'qualquer valor sem cobrar: em produção isso e entregar mercadoria de ' +
              'graca. Configure um gateway real. Apenas em ambiente de teste, e so ' +
              'nele, defina ALLOW_FAKE_PAYMENT_GATEWAY=true.',
          );
        }
        return [balcao, eletronico];
      },
      inject: [CashPaymentProvider, FakeElectronicProvider],
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
