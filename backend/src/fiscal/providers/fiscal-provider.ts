import type {
  FiscalDocument,
  Sale,
  SaleItem,
  StoreSettings,
} from '@prisma/client';

/**
 * Porta de emissao fiscal (NFC-e modelo 65).
 *
 * O fluxo de venda depende apenas desta interface — trocar o provedor
 * (fake de homologacao -> Focus NFe / PlugNotas / ...) nao toca no
 * SalesService nem no controle de caixa.
 */

export type SaleForFiscal = Sale & { items: SaleItem[] };

export interface FiscalEmitContext {
  document: FiscalDocument;
  sale: SaleForFiscal;
  store: StoreSettings;
}

export interface FiscalEmitResult {
  status: 'AUTORIZADA' | 'REJEITADA';
  accessKey?: string;
  protocol?: string;
  qrCode?: string;
  xmlUrl?: string;
  danfeUrl?: string;
  rejectionReason?: string;
}

export interface FiscalCancelContext {
  document: FiscalDocument;
  reason: string;
}

export interface FiscalCancelResult {
  status: 'CANCELADA' | 'REJEITADA';
  protocol?: string;
  rejectionReason?: string;
}

export interface FiscalProvider {
  /** Nome curto, gravado em FiscalDocument.provider para rastreio. */
  readonly name: string;
  emit(ctx: FiscalEmitContext): Promise<FiscalEmitResult>;
  cancel(ctx: FiscalCancelContext): Promise<FiscalCancelResult>;
}

/** Token de injecao do provedor fiscal ativo. */
export const FISCAL_PROVIDER = Symbol('FISCAL_PROVIDER');
