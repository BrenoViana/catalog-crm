import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FiscalStatus, Prisma } from '@prisma/client';
import { AuthorizationService } from '../access/authorization.service';
import { MetricsService } from '../common/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../settings/app-settings.service';
import {
  FiscalNumberingService,
  RangeExhaustedError,
} from './fiscal-numbering.service';
import {
  FISCAL_PROVIDER,
  type FiscalEmitResult,
  type FiscalProvider,
} from './providers/fiscal-provider';

/**
 * Estados de onde uma emissao NORMAL pode (re)partir. CONTINGENCIA fica de
 * fora: um documento em contingencia so avanca por `transmitContingency`, que
 * transmite com a mesma serie/numero e nunca realoca.
 */
const EMITTABLE: FiscalStatus[] = ['PENDENTE', 'REJEITADA'];

/** Teto do backoff entre tentativas de transmitir uma contingencia. */
const MAX_CONTINGENCY_BACKOFF_MS = 30 * 60_000;

@Injectable()
export class FiscalService {
  private readonly log = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
    private readonly numbering: FiscalNumberingService,
    private readonly authorization: AuthorizationService,
    private readonly metrics: MetricsService,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProvider,
  ) {}

  /** Teto de tentativas configuravel (fiscal.maxEmitAttempts). */
  private maxAttempts() {
    return this.settings.getNumber('fiscal.maxEmitAttempts');
  }

  list(status?: string) {
    const parsed =
      status && status in FiscalStatus ? (status as FiscalStatus) : undefined;
    return this.prisma.fiscalDocument.findMany({
      where: { status: parsed },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        sale: {
          select: { id: true, number: true, total: true, status: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { id },
      include: { sale: { select: { id: true, number: true, total: true } } },
    });
    if (!doc) throw new NotFoundException('Documento fiscal nao encontrado.');
    return doc;
  }

  /**
   * Emite (ou reemite) o documento fiscal. Idempotente: uma trava condicional
   * move o documento para PROCESSANDO antes de falar com o provedor, de modo
   * que chamadas concorrentes (PDV + botao do gerente + job) nao emitam duas
   * vezes. Se ja estiver AUTORIZADA/CANCELADA/PROCESSANDO, devolve como esta.
   */
  async emit(documentId: string) {
    const pre = await this.prisma.fiscalDocument.findUnique({
      where: { id: documentId },
      select: { status: true, emissionType: true },
    });
    if (!pre) throw new NotFoundException('Documento fiscal nao encontrado.');
    // Documento ja em contingencia: "reprocessar" significa transmitir a SEFAZ
    // com a serie e o numero que ele ja tem — nunca voltar a alocar numero.
    if (
      pre.status === 'CONTINGENCIA' ||
      pre.emissionType === 'CONTINGENCIA_OFFLINE'
    ) {
      return this.transmitContingency(documentId);
    }

    const claimed = await this.prisma.fiscalDocument.updateMany({
      where: { id: documentId, status: { in: EMITTABLE } },
      data: {
        status: 'PROCESSANDO',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      return this.findOne(documentId);
    }

    // A partir daqui o documento esta em PROCESSANDO. Qualquer erro NAO tratado
    // (uma consulta que falha antes de chamar o provedor) deixaria o documento
    // preso em PROCESSANDO para sempre — estado de onde nada o recupera. O
    // try/catch geral devolve o documento a PENDENTE para o proximo ciclo.
    try {
      const document = await this.prisma.fiscalDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { sale: { include: { items: true } } },
      });
      const store = await this.prisma.storeSettings.findFirst();
      if (!store) {
        return await this.settle(documentId, {
          status: 'REJEITADA',
          rejectionReason: 'Configuracoes da loja nao preenchidas.',
        });
      }

      let result: FiscalEmitResult;
      try {
        result = await this.provider.emit({
          document,
          sale: document.sale,
          store,
        });
      } catch (err) {
        this.log.error(
          `Emissao do doc ${documentId} falhou no provedor ${this.provider.name}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        // Erro de comunicacao: volta a PENDENTE para retry, ate o teto de
        // tentativas. Estourado o teto, tenta a contingencia antes de desistir
        // — "SEFAZ fora do ar" nao pode virar "venda sem nota" enquanto houver
        // serie de contingencia configurada.
        const maxAttempts = await this.maxAttempts();
        if (document.attempts < maxAttempts) {
          return await this.prisma.fiscalDocument.update({
            where: { id: documentId },
            data: {
              status: 'PENDENTE',
              rejectionReason:
                'Falha de comunicacao com o provedor fiscal — sera reprocessado.',
            },
          });
        }
        const contingency = await this.tryEnterContingency(document);
        if (contingency) return contingency;
        return await this.prisma.fiscalDocument.update({
          where: { id: documentId },
          data: {
            status: 'REJEITADA',
            rejectionReason: `Sem resposta do provedor apos ${maxAttempts} tentativas.`,
          },
        });
      }

      return await this.settle(documentId, result);
    } catch (err) {
      this.log.error(
        `Erro inesperado ao emitir o doc ${documentId}: ${
          err instanceof Error ? err.message : err
        } — devolvido a PENDENTE.`,
      );
      return this.prisma.fiscalDocument
        .update({
          where: { id: documentId },
          data: { status: 'PENDENTE' },
        })
        .catch(() => this.findOne(documentId));
    }
  }

  /** Emite o documento pendente de uma venda (disparo fire-and-forget do PDV). */
  async emitForSale(saleId: string) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { saleId },
      select: { id: true },
    });
    return doc ? this.emit(doc.id) : null;
  }

  /** Cancela o documento fiscal de uma venda (chamado no cancelamento da venda). */
  async cancelForSale(saleId: string, reason: string) {
    const doc = await this.prisma.fiscalDocument.findUnique({
      where: { saleId },
      select: { id: true },
    });
    return doc ? this.cancelDocument(doc.id, reason) : null;
  }

  async cancelDocument(documentId: string, reason: string) {
    const document = await this.prisma.fiscalDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Documento fiscal nao encontrado.');
    if (document.status === 'CANCELADA') return document;

    // Ainda nao autorizada: nao ha nota na SEFAZ, basta marcar como cancelada.
    if (document.status !== 'AUTORIZADA') {
      return this.prisma.fiscalDocument.update({
        where: { id: documentId },
        data: { status: 'CANCELADA', canceledAt: new Date(), rejectionReason: null },
      });
    }

    try {
      const res = await this.provider.cancel({ document, reason });
      if (res.status === 'CANCELADA') {
        return this.prisma.fiscalDocument.update({
          where: { id: documentId },
          data: {
            status: 'CANCELADA',
            canceledAt: new Date(),
            protocol: res.protocol ?? document.protocol,
            rejectionReason: null,
          },
        });
      }
      return this.prisma.fiscalDocument.update({
        where: { id: documentId },
        data: {
          rejectionReason:
            res.rejectionReason ?? 'Cancelamento rejeitado pelo provedor fiscal.',
        },
      });
    } catch (err) {
      this.log.error(
        `Cancelamento do doc ${documentId} falhou: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return this.prisma.fiscalDocument.update({
        where: { id: documentId },
        data: {
          rejectionReason:
            'Erro ao cancelar junto ao provedor fiscal — tente novamente.',
        },
      });
    }
  }

  /**
   * Reprocessa documentos presos em PENDENTE/REJEITADA que ainda nao estouraram
   * o teto de tentativas. Uso: botao do gerente ou um cron futuro.
   */
  async processPending() {
    const pend = await this.prisma.fiscalDocument.findMany({
      where: {
        status: { in: ['PENDENTE', 'REJEITADA'] },
        attempts: { lt: await this.maxAttempts() },
      },
      select: { id: true },
      take: 50,
    });
    let authorized = 0;
    let rejected = 0;
    for (const { id } of pend) {
      const doc = await this.emit(id);
      if (doc?.status === 'AUTORIZADA') authorized++;
      else if (doc?.status === 'REJEITADA') rejected++;
    }
    return { picked: pend.length, authorized, rejected };
  }

  // ------------------------------------------------------------- Contingencia

  /**
   * Move um documento para a serie de contingencia, alocando serie+numero
   * proprios. Devolve o documento atualizado, ou `null` quando nao ha para onde
   * ir (contingencia nao configurada, ou a faixa do terminal acabou) — nesse
   * caso o chamador segue para REJEITADA.
   */
  private async tryEnterContingency(document: {
    id: string;
    sale: { terminalId: string | null };
  }) {
    const configured = await this.numbering.isConfigured(this.prisma, {
      terminalId: document.sale.terminalId,
    });
    if (!configured) return null;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const { series, number } = await this.numbering.allocate(tx, {
          terminalId: document.sale.terminalId,
        });
        return tx.fiscalDocument.update({
          where: { id: document.id },
          data: {
            status: 'CONTINGENCIA',
            emissionType: 'CONTINGENCIA_OFFLINE',
            series,
            number,
            emittedInContingencyAt: new Date(),
            contingencyRetryAt: new Date(),
            rejectionReason: null,
          },
        });
      });
      this.metrics.increment('fiscal.contingencia');
      return updated;
    } catch (err) {
      if (err instanceof RangeExhaustedError) {
        this.metrics.increment('fiscal.contingencia.faixaEsgotada');
        this.log.error(err.message);
        return null;
      }
      throw err;
    }
  }

  /**
   * Forca um documento para a contingencia por decisao manual do gerente (a
   * SEFAZ caiu e ele nao quer esperar o teto de tentativas). Auditado.
   */
  async enterContingency(documentId: string, userId: string) {
    const pre = await this.prisma.fiscalDocument.findUnique({
      where: { id: documentId },
      select: { status: true, emissionType: true },
    });
    if (!pre) throw new NotFoundException('Documento fiscal nao encontrado.');
    // Ja esta em contingencia: nao realoca numero, so devolve como esta.
    if (
      pre.status === 'CONTINGENCIA' ||
      pre.emissionType === 'CONTINGENCIA_OFFLINE'
    ) {
      return this.findOne(documentId);
    }

    const claimed = await this.prisma.fiscalDocument.updateMany({
      where: {
        id: documentId,
        status: { in: [...EMITTABLE, 'PROCESSANDO'] },
      },
      data: { status: 'PROCESSANDO', lastAttemptAt: new Date() },
    });
    if (claimed.count !== 1) return this.findOne(documentId);

    const document = await this.prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { sale: { select: { terminalId: true, number: true } } },
    });
    const moved = await this.tryEnterContingency(document);
    if (!moved) {
      // Nao ha contingencia configurada: devolve o documento a PENDENTE em vez
      // de deixa-lo preso em PROCESSANDO.
      await this.prisma.fiscalDocument.update({
        where: { id: documentId },
        data: { status: 'PENDENTE' },
      });
      return this.findOne(documentId);
    }
    await this.authorization.record({
      action: 'fiscal.contingency',
      permissionKey: 'fiscal.contingency',
      actorId: userId,
      targetType: 'FiscalDocument',
      targetId: documentId,
      detail: {
        venda: document.sale.number,
        serie: moved.series,
        numero: moved.number,
      },
    });
    return moved;
  }

  /**
   * Transmite a SEFAZ os documentos parados em contingencia. Chamado pelo botao
   * "reprocessar contingencia" (a rede voltou AGORA) — por isso ignora o
   * backoff: `contingencyRetryAt` so vale para a varredura automatica de minuto.
   */
  async processContingency() {
    const due = await this.prisma.fiscalDocument.findMany({
      where: { status: 'CONTINGENCIA' },
      select: { id: true },
      take: 50,
    });
    let authorized = 0;
    let rejected = 0;
    for (const { id } of due) {
      const doc = await this.transmitContingency(id);
      if (doc?.status === 'AUTORIZADA') authorized++;
      else if (doc?.status === 'REJEITADA') rejected++;
    }
    return { picked: due.length, authorized, rejected };
  }

  /**
   * Transmite UM documento de contingencia. A serie e o numero de contingencia
   * ficam intocados: uma nota autorizada offline precisa chegar a SEFAZ com a
   * mesma chave. Erro de comunicacao nao rejeita — reagenda com backoff; so uma
   * rejeicao de verdade da SEFAZ vira REJEITADA.
   */
  async transmitContingency(documentId: string) {
    const claimed = await this.prisma.fiscalDocument.updateMany({
      where: { id: documentId, status: 'CONTINGENCIA' },
      data: {
        status: 'PROCESSANDO',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    if (claimed.count !== 1) return this.findOne(documentId);

    let result: FiscalEmitResult;
    try {
      const document = await this.prisma.fiscalDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { sale: { include: { items: true } } },
      });
      const store = await this.prisma.storeSettings.findFirst();
      if (!store) {
        // Sem loja nao ha como transmitir; devolve a contingencia para o
        // proximo ciclo em vez de rejeitar uma nota que pode estar autorizada
        // offline.
        return await this.prisma.fiscalDocument.update({
          where: { id: documentId },
          data: {
            status: 'CONTINGENCIA',
            contingencyRetryAt: this.nextRetry(document.attempts),
          },
        });
      }

      try {
        result = await this.provider.emit({
          document,
          sale: document.sale,
          store,
        });
      } catch (err) {
        this.log.warn(
          `Transmissao da contingencia ${documentId} falhou: ${
            err instanceof Error ? err.message : err
          } — reagendada.`,
        );
        return await this.prisma.fiscalDocument.update({
          where: { id: documentId },
          data: {
            status: 'CONTINGENCIA',
            contingencyRetryAt: this.nextRetry(document.attempts),
          },
        });
      }
    } catch (err) {
      // Erro inesperado depois de reivindicar o documento: nunca o deixa preso
      // em PROCESSANDO — devolve a CONTINGENCIA para o proximo ciclo.
      this.log.error(
        `Erro inesperado ao transmitir a contingencia ${documentId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return this.prisma.fiscalDocument
        .update({
          where: { id: documentId },
          data: { status: 'CONTINGENCIA', contingencyRetryAt: this.nextRetry(1) },
        })
        .catch(() => this.findOne(documentId));
    }

    if (result.status === 'AUTORIZADA') {
      this.metrics.increment('fiscal.contingencia.autorizada');
    }
    return this.settle(documentId, result, { fromContingency: true });
  }

  /** Backoff exponencial a partir do teto de tentativas, com limite. */
  private nextRetry(attempts: number) {
    const step = Math.max(0, attempts - 1);
    const delay = Math.min(
      MAX_CONTINGENCY_BACKOFF_MS,
      60_000 * 2 ** Math.min(step, 20),
    );
    return new Date(Date.now() + delay);
  }

  private settle(
    documentId: string,
    result: FiscalEmitResult,
    opts: { fromContingency?: boolean } = {},
  ) {
    const authorized = result.status === 'AUTORIZADA';
    const data: Prisma.FiscalDocumentUpdateInput = {
      status: result.status,
      provider: this.provider.name,
      accessKey: result.accessKey ?? null,
      protocol: result.protocol ?? null,
      qrCode: result.qrCode ?? null,
      xmlUrl: result.xmlUrl ?? null,
      danfeUrl: result.danfeUrl ?? null,
      rejectionReason: authorized
        ? null
        : result.rejectionReason ?? 'Rejeitada pelo provedor fiscal.',
      issuedAt: authorized ? new Date() : null,
    };
    // Documento reconciliado da contingencia: some da fila do runner. A serie,
    // o numero e o emissionType permanecem — a chave offline ja os encravou.
    if (opts.fromContingency) data.contingencyRetryAt = null;
    return this.prisma.fiscalDocument.update({ where: { id: documentId }, data });
  }
}
