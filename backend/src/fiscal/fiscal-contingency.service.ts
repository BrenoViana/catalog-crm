import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { LicenseService } from '../license/license.service';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalService } from './fiscal.service';

/** De quanto em quanto tempo o runner procura contingencia vencida. */
const TICK_MS = 60_000;

/** Documentos transmitidos por ciclo — mesmo teto do agendamento de relatorios. */
const BATCH = 20;

/**
 * Reconciliacao da contingencia fiscal.
 *
 * Toda NFC-e que entrou em contingencia (SEFAZ fora do ar) precisa chegar a
 * SEFAZ quando a conexao voltar. Este runner faz isso sozinho, de minuto em
 * minuto, com backoff. `running` evita reentrancia no processo; entre processos
 * quem protege e a trava condicional `CONTINGENCIA -> PROCESSANDO` dentro de
 * `transmitContingency`. O timer e `unref` para nao segurar o encerramento.
 */
@Injectable()
export class FiscalContingencyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(FiscalContingencyService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
    private readonly fiscal: FiscalService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Sem o modulo fiscal licenciado, a loja nao emite NFC-e — nada a
      // reconciliar. (Um documento em contingencia so existe se o modulo ja
      // valeu; o gate aqui e para nao varrer o banco a toa.)
      if (!(await this.license.allows('fiscal'))) return;

      const now = new Date();
      const due = await this.prisma.fiscalDocument.findMany({
        where: {
          status: 'CONTINGENCIA',
          OR: [
            { contingencyRetryAt: null },
            { contingencyRetryAt: { lte: now } },
          ],
        },
        select: { id: true },
        take: BATCH,
      });
      for (const { id } of due) {
        await this.fiscal.transmitContingency(id).catch((err) => {
          this.log.error(
            `Falha ao transmitir a contingência ${id}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        });
      }
    } finally {
      this.running = false;
    }
  }
}
