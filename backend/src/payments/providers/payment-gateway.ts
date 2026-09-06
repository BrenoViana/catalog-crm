import type { Payment, PaymentMethod, Sale } from '@prisma/client';

/**
 * Porta de pagamento.
 *
 * Mesma jogada da porta fiscal: o fluxo de venda depende apenas desta
 * interface. Dinheiro e uma implementacao como qualquer outra — trocar o
 * eletronico simulado por TEF (PayGo/SiTef) ou por um PSP de Pix nao toca
 * no SalesService nem no controle de caixa.
 *
 * O pagamento e um processo, nao um fato: PENDENTE -> PROCESSANDO ->
 * AUTORIZADO -> CONFIRMADO, com NEGADO e ESTORNADO como saidas. Os estados
 * ja existem em PaymentStatus; esta interface e quem os move.
 */

export interface PaymentAuthorizeContext {
  /** Pagamento ja persistido (nasce PENDENTE para quem passa por gateway). */
  payment: Payment;
  /** Venda a que ele pertence — numero e total, para o comprovante. */
  sale: Pick<Sale, 'id' | 'number' | 'total'>;
}

export interface PaymentAuthorizeResult {
  /**
   * Estado alcancado. `CONFIRMADO` e captura imediata (dinheiro, TEF a
   * vista); `AUTORIZADO` reserva o valor e espera captura; `PROCESSANDO`
   * e o Pix esperando o webhook do PSP.
   */
  status: 'PROCESSANDO' | 'AUTORIZADO' | 'CONFIRMADO' | 'NEGADO';
  /** Identificador do pagamento no provedor, para conciliacao. */
  externalId?: string;
  /** Codigo de autorizacao (NSU/authorization code) impresso no comprovante. */
  authorizationCode?: string;
  /** Payload do QR (Pix) que o cliente le para pagar. */
  qrCode?: string;
  rejectionReason?: string;
}

export interface PaymentRefundContext {
  payment: Payment;
  reason: string;
}

export interface PaymentRefundResult {
  status: 'ESTORNADO' | 'NEGADO';
  rejectionReason?: string;
}

export interface PaymentGateway {
  /** Nome curto, gravado em Payment.provider para rastreio. */
  readonly name: string;
  /** Quais formas de pagamento este provedor atende. */
  supports(method: PaymentMethod): boolean;
  authorize(ctx: PaymentAuthorizeContext): Promise<PaymentAuthorizeResult>;
  refund(ctx: PaymentRefundContext): Promise<PaymentRefundResult>;
}

/**
 * Token de injecao. Diferente da porta fiscal (um provedor por vez), aqui
 * convivem varios: dinheiro nunca vai para o mesmo lugar que o cartao. O
 * PaymentsService escolhe pelo `supports(method)`.
 */
export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');
