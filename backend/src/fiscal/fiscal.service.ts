import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FiscalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../settings/app-settings.service';
import {
  FISCAL_PROVIDER,
  type FiscalEmitResult,
  type FiscalProvider,
} from './providers/fiscal-provider';

/** Estados a partir dos quais uma (re)emissao pode ser tentada. */
const EMITTABLE: FiscalStatus[] = ['PENDENTE', 'REJEITADA', 'CONTINGENCIA'];

@Injectable()
export class FiscalService {
  private readonly log = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
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

    const document = await this.prisma.fiscalDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { sale: { include: { items: true } } },
    });
    const store = await this.prisma.storeSettings.findFirst();
    if (!store) {
      return this.settle(documentId, {
        status: 'REJEITADA',
        rejectionReason: 'Configuracoes da loja nao preenchidas.',
      });
    }

    let result: FiscalEmitResult;
    try {
      result = await this.provider.emit({ document, sale: document.sale, store });
    } catch (err) {
      this.log.error(
        `Emissao do doc ${documentId} falhou no provedor ${this.provider.name}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      // Erro de comunicacao: volta a PENDENTE para retry, ate o teto de tentativas.
      const maxAttempts = await this.maxAttempts();
      const giveUp = document.attempts >= maxAttempts;
      return this.prisma.fiscalDocument.update({
        where: { id: documentId },
        data: {
          status: giveUp ? 'REJEITADA' : 'PENDENTE',
          rejectionReason: giveUp
            ? `Sem resposta do provedor apos ${maxAttempts} tentativas.`
            : 'Falha de comunicacao com o provedor fiscal — sera reprocessado.',
        },
      });
    }

    return this.settle(documentId, result);
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

  private settle(documentId: string, result: FiscalEmitResult) {
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
    return this.prisma.fiscalDocument.update({ where: { id: documentId }, data });
  }
}
