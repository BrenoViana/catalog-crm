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

/**
 * Regra de contingencia para um provedor real: quando
 * `document.emissionType === 'CONTINGENCIA_OFFLINE'`, a NFC-e sai com tpEmis=9,
 * dhCont = `document.emittedInContingencyAt` e xJust; e, na reconexao, o mesmo
 * XML/chave e transmitido a SEFAZ — a serie e o numero de contingencia NUNCA
 * sao renumerados para a serie normal. A transicao para CONTINGENCIA e decisao
 * do FiscalService, nao do provedor: `emit` continua devolvendo so
 * AUTORIZADA/REJEITADA.
 */

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
