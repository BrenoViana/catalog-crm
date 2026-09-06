import { Injectable } from '@nestjs/common';
import type { PaymentMethod } from '@prisma/client';
import type {
  PaymentAuthorizeResult,
  PaymentGateway,
  PaymentRefundResult,
} from './payment-gateway';

/**
 * Dinheiro e o que se liquida no balcao sem terceiro: especie, crediario
 * (vira titulo a receber em F5) e "outro". Nao ha chamada externa — a
 * confirmacao e imediata, exatamente como o sistema sempre se comportou.
 *
 * Existe como provedor, e nao como excecao no SalesService, porque e isso
 * que permite ao fluxo de venda tratar toda forma de pagamento igual.
 */
@Injectable()
export class CashPaymentProvider implements PaymentGateway {
  readonly name = 'balcao';

  private static readonly METHODS: PaymentMethod[] = [
    'DINHEIRO',
    'CREDIARIO',
    'OUTRO',
    // Resgate de fidelidade: o "pagamento" e credito que a loja ja concedeu.
    // Nao ha terceiro a consultar, entao confirma no balcao como o dinheiro.
    'FIDELIDADE',
  ];

  supports(method: PaymentMethod): boolean {
    return CashPaymentProvider.METHODS.includes(method);
  }

  async authorize(): Promise<PaymentAuthorizeResult> {
    return { status: 'CONFIRMADO' };
  }

  /**
   * O estorno do dinheiro em si acontece na gaveta e ja e registrado como
   * CashMovement pelo cancelamento da venda; aqui so marcamos o pagamento.
   */
  async refund(): Promise<PaymentRefundResult> {
    return { status: 'ESTORNADO' };
  }
}
