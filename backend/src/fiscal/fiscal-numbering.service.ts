import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Advisory lock transacional que serializa a alocacao de numero fiscal de
 * contingencia — a mesma tecnica de SALE_NUMBER_LOCK em SalesService, chave
 * propria. O `@@unique([model, series, number])` do FiscalDocument e o backstop
 * entre transacoes caso duas alocacoes escapem do lock.
 */
const FISCAL_CONTINGENCY_LOCK = 727280;

/** A faixa de contingencia do terminal acabou: nenhum numero foi emitido. */
export class RangeExhaustedError extends Error {
  constructor(readonly terminalCode: string) {
    super(
      `A faixa de numeração de contingência do terminal "${terminalCode}" acabou.`,
    );
    this.name = 'RangeExhaustedError';
  }
}

export interface ContingencyNumber {
  series: number;
  number: number;
}

/**
 * Aloca serie + numero de contingencia da NFC-e. Fica separado de FiscalService
 * e SalesService porque os dois precisam alocar (o primeiro quando o provedor
 * cai depois da venda, o segundo quando a loja ja esta em contingencia no
 * momento da venda) e a chave do advisory lock tem de morar num lugar so.
 */
@Injectable()
export class FiscalNumberingService {
  /**
   * @throws {RangeExhaustedError} quando o terminal tem faixa propria e ela
   *   acabou — nenhum numero e emitido e o chamador decide o desfecho.
   * @throws {BadRequestException} quando nao ha nenhuma fonte de numeracao de
   *   contingencia configurada.
   */
  async allocate(
    tx: Tx,
    opts: { terminalId?: string | null },
  ): Promise<ContingencyNumber> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FISCAL_CONTINGENCY_LOCK})`;

    const terminal = opts.terminalId
      ? await tx.terminal.findUnique({ where: { id: opts.terminalId } })
      : null;

    // Terminal com faixa propria: numera dentro dela e recusa passar do fim —
    // sem wrap, sem cair na serie da loja, para o terminal A nunca consumir o
    // bloco do terminal B.
    if (terminal?.contingencySeries != null) {
      const next =
        terminal.contingencyNextNumber ?? terminal.contingencyRangeStart ?? 1;
      if (
        terminal.contingencyRangeEnd != null &&
        next > terminal.contingencyRangeEnd
      ) {
        throw new RangeExhaustedError(terminal.code);
      }
      await tx.terminal.update({
        where: { id: terminal.id },
        data: { contingencyNextNumber: next + 1 },
      });
      return { series: terminal.contingencySeries, number: next };
    }

    // Sem faixa no terminal: usa a serie de contingencia da loja.
    const store = await tx.storeSettings.findFirst({
      select: {
        id: true,
        nfceContingencySeries: true,
        nfceContingencyNextNumber: true,
      },
    });
    if (!store || store.nfceContingencySeries == null) {
      throw new BadRequestException(
        'Contingência da NFC-e não configurada: defina a série de contingência da loja ou uma faixa no terminal.',
      );
    }
    const number = store.nfceContingencyNextNumber;
    await tx.storeSettings.update({
      where: { id: store.id },
      data: { nfceContingencyNextNumber: number + 1 },
    });
    return { series: store.nfceContingencySeries, number };
  }

  /**
   * Ha alguma fonte de numeracao de contingencia disponivel? (Serie da loja ou
   * faixa no terminal.) Usado para decidir se vale a pena tentar entrar em
   * contingencia em vez de rejeitar de vez.
   */
  async isConfigured(
    prisma: Tx,
    opts: { terminalId?: string | null },
  ): Promise<boolean> {
    const store = await prisma.storeSettings.findFirst({
      select: { nfceContingencySeries: true },
    });
    if (store?.nfceContingencySeries != null) return true;
    if (!opts.terminalId) return false;
    const terminal = await prisma.terminal.findUnique({
      where: { id: opts.terminalId },
      select: { contingencySeries: true },
    });
    return terminal?.contingencySeries != null;
  }
}
