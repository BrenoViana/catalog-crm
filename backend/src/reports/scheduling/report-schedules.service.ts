import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ReportChannel, ReportSchedule } from '@prisma/client';
import { AuthorizationService } from '../../access/authorization.service';
import { FixedWindowLimiter } from '../../common/fixed-window-limiter';
import { MetricsService } from '../../common/metrics.service';
import { LicenseService } from '../../license/license.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isExportable, ReportCsvService } from '../report-csv.service';
import { maskRecipient, type DeliveryChannel } from './channels/delivery-channel';
import { RegistroChannel } from './channels/registro.channel';
import {
  CreateReportScheduleDto,
  UpdateReportScheduleDto,
} from './dto/report-schedule.dto';
import { nextRun, windowFor } from './schedule-window';

/** De quanto em quanto tempo o runner procura agendamento vencido. */
const TICK_MS = 60_000;

/** Teto de entregas devolvido no historico de um agendamento. */
const MAX_DELIVERIES = 50;

@Injectable()
export class ReportSchedulesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReportSchedulesService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Envios manuais em voo, por agendamento. */
  private readonly emExecucao = new Set<string>();
  /**
   * Teto do "enviar agora" por usuario. Gerar um relatorio mensal e uma
   * agregacao pesada sobre `Sale`/`SaleItem`; um botao em loop ocuparia o pool
   * de conexoes que o balcao usa para vender. A cadencia automatica nao passa
   * por aqui.
   */
  private readonly manualLimiter = new FixedWindowLimiter();
  private readonly channels: Map<ReportChannel, DeliveryChannel>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly csv: ReportCsvService,
    private readonly authorization: AuthorizationService,
    private readonly license: LicenseService,
    private readonly metrics: MetricsService,
    registro: RegistroChannel,
  ) {
    // Um canal so, por enquanto. E-mail e WhatsApp entram aqui como irmaos do
    // REGISTRO quando a loja trouxer a credencial — nada mais no agendamento
    // precisa mudar.
    this.channels = new Map([[registro.channel, registro]]);
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // `unref` para o processo nao ficar preso ao timer no encerramento: um
    // backend que nao termina e um deploy que trava esperando por ele.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ CRUD

  async list() {
    const rows = await this.prisma.reportSchedule.findMany({
      orderBy: [{ active: 'desc' }, { nextRunAt: 'asc' }],
      include: {
        createdBy: { select: { id: true, name: true } },
        deliveries: { orderBy: { runAt: 'desc' }, take: 1 },
      },
    });
    return rows.map((r) => this.present(r, r));
  }

  async findOne(id: string) {
    const row = await this.prisma.reportSchedule.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true } },
        deliveries: { orderBy: { runAt: 'desc' }, take: MAX_DELIVERIES },
      },
    });
    if (!row) throw new NotFoundException('Agendamento nao encontrado.');
    return { ...this.present(row, row), entregas: row.deliveries };
  }

  async create(dto: CreateReportScheduleDto, userId: string) {
    this.assertShape(dto);
    const created = await this.prisma.reportSchedule.create({
      data: {
        report: dto.report,
        name: dto.name.trim(),
        frequency: dto.frequency,
        hour: dto.hour,
        weekday: dto.frequency === 'SEMANAL' ? dto.weekday ?? 1 : null,
        monthday: dto.frequency === 'MENSAL' ? dto.monthday ?? 1 : null,
        channel: dto.channel,
        recipient: dto.recipient.trim(),
        active: dto.active ?? true,
        nextRunAt: nextRun({
          frequency: dto.frequency,
          hour: dto.hour,
          weekday: dto.weekday ?? null,
          monthday: dto.monthday ?? null,
        }),
        createdById: userId,
      },
    });

    // Agendamento e uma saida CONTINUA de custo, margem e desempenho por
    // operador para fora do sistema — mais perene que uma exportacao avulsa,
    // porque continua saindo depois que quem criou perdeu o acesso. Por isso
    // criar, alterar e remover entram na trilha, como a exportacao.
    await this.record('reports.schedule.create', userId, created);
    return this.present(created);
  }

  async update(id: string, dto: UpdateReportScheduleDto, userId: string) {
    const atual = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Agendamento nao encontrado.');

    const merged = {
      frequency: dto.frequency ?? atual.frequency,
      hour: dto.hour ?? atual.hour,
      weekday: dto.weekday ?? atual.weekday,
      monthday: dto.monthday ?? atual.monthday,
      report: dto.report ?? atual.report,
      channel: dto.channel ?? atual.channel,
      recipient: dto.recipient?.trim() ?? atual.recipient,
    };
    this.assertShape(merged);

    const updated = await this.prisma.reportSchedule.update({
      where: { id },
      data: {
        report: merged.report,
        name: dto.name?.trim() ?? atual.name,
        frequency: merged.frequency,
        hour: merged.hour,
        weekday: merged.frequency === 'SEMANAL' ? merged.weekday ?? 1 : null,
        monthday: merged.frequency === 'MENSAL' ? merged.monthday ?? 1 : null,
        channel: merged.channel,
        recipient: merged.recipient,
        active: dto.active ?? atual.active,
        // Qualquer mudanca de cadencia recalcula a proxima execucao: manter o
        // `nextRunAt` antigo faria o agendamento das 7h sair as 22h uma ultima
        // vez, no horario que acabou de ser trocado.
        nextRunAt: nextRun(merged),
      },
    });
    await this.record('reports.schedule.update', userId, updated);
    return this.present(updated);
  }

  async remove(id: string, userId: string) {
    const atual = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Agendamento nao encontrado.');
    await this.prisma.reportSchedule.delete({ where: { id } });
    await this.record('reports.schedule.delete', userId, atual);
    return { ok: true };
  }

  /**
   * Execucao manual ("enviar agora"), sem mexer na cadencia.
   *
   * E o unico jeito de o gestor conferir que o agendamento funciona sem esperar
   * ate as 7h da manha — e o jeito de o suporte reproduzir uma falha.
   */
  async runNow(id: string, userId: string) {
    const espera = this.manualLimiter.hit([`schedule-run:${userId}`], 5, 600_000);
    if (espera !== null) {
      throw new HttpException(
        `Muitos envios manuais seguidos. Tente de novo em ${espera}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const schedule = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!schedule) throw new NotFoundException('Agendamento nao encontrado.');
    // Sem esta trava, N cliques disparam N geracoes concorrentes do mesmo
    // relatorio — a reentrancia que o `running` do runner ja evita no ciclo
    // automatico.
    if (this.emExecucao.has(id)) {
      throw new ConflictException('Já existe um envio deste agendamento em andamento.');
    }
    this.emExecucao.add(id);
    try {
      const delivery = await this.deliver(schedule, new Date(), false);
      await this.record('reports.schedule.run', userId, schedule);
      return delivery;
    } finally {
      this.emExecucao.delete(id);
    }
  }

  // ---------------------------------------------------------------- Runner

  /**
   * Uma varredura do relogio.
   *
   * `running` evita reentrancia dentro do processo: um envio que demore mais
   * que o tique nao pode ser iniciado de novo pelo tique seguinte. Entre
   * processos, quem protege e o `updateMany` condicional dentro de `deliver` —
   * so avanca (e so entrega) quem conseguir mover o `nextRunAt`.
   */
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Sem o modulo de relatorios licenciado, nada sai. Um agendamento criado
      // enquanto o modulo valia continuaria mandando custo e margem para fora
      // depois do vencimento, o que e exatamente o que o gate existe para
      // impedir.
      if (!(await this.license.allows('relatorios'))) return;

      const agora = new Date();
      const devidos = await this.prisma.reportSchedule.findMany({
        where: { active: true, nextRunAt: { lte: agora } },
        take: 20,
      });
      for (const schedule of devidos) {
        await this.deliver(schedule, agora, true).catch((err) => {
          this.log.error(
            `Falha no agendamento ${schedule.id}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        });
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Gera o relatorio, entrega e registra o desfecho.
   *
   * `advanceSchedule` separa a execucao automatica do "enviar agora": o teste
   * manual do gestor nao pode consumir a ocorrencia programada do dia.
   */
  private async deliver(
    schedule: ReportSchedule,
    runAt: Date,
    advanceSchedule: boolean,
  ) {
    if (advanceSchedule) {
      // Reivindica a ocorrencia ANTES de qualquer trabalho. Dois processos (ou
      // dois deploys em paralelo) leem a mesma lista de devidos; so um consegue
      // mover o `nextRunAt` de onde ele estava, e so esse entrega. Sem isto o
      // gestor recebe o relatorio em duplicata e para de confiar nele.
      const claim = await this.prisma.reportSchedule.updateMany({
        where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt: nextRun(schedule, runAt), lastRunAt: runAt },
      });
      if (claim.count !== 1) return null;
    }

    const period = windowFor(schedule.frequency, runAt);
    let status: 'ENVIADO' | 'FALHOU' = 'FALHOU';
    let error: string | null = null;
    let rows = 0;
    let bytes = 0;

    try {
      if (!isExportable(schedule.report)) {
        throw new BadRequestException(`Relatório desconhecido: ${schedule.report}.`);
      }
      const built = await this.csv.build(schedule.report, {
        from: period.from,
        to: period.to,
      });
      rows = built.linhas;
      bytes = Buffer.byteLength(built.csv, 'utf8');

      const channel = this.channels.get(schedule.channel);
      if (!channel) {
        // Canal escolhido na tela mas ainda sem provedor configurado. Falhar
        // aqui, visivelmente na trilha, e melhor do que o agendamento fingir
        // sucesso: o gestor precisa saber que o e-mail nunca saiu.
        throw new BadRequestException(
          `Canal ${schedule.channel} ainda nao tem provedor configurado nesta instalacao.`,
        );
      }

      const result = await channel.send({
        scheduleName: schedule.name,
        report: schedule.report,
        recipient: schedule.recipient,
        period,
        attachment: {
          filename: `${schedule.report}-${period.from}_${period.to}.csv`,
          content: built.csv,
          rows: built.linhas,
        },
      });
      if (!result.ok) throw new Error(result.error ?? 'Falha no envio.');
      status = 'ENVIADO';
    } catch (err) {
      const detalhe = err instanceof Error ? err.message : String(err);
      // A trilha e lida por qualquer um com `reports.schedule`. Mensagem crua de
      // excecao carrega nome de tabela e, as vezes, valor de campo — o mesmo
      // vazamento que ja foi fechado no motivo de recusa do pagamento. O texto
      // exato fica no log do servidor; a trilha recebe o motivo de catalogo.
      error =
        err instanceof BadRequestException ? detalhe.slice(0, 300) : 'Falha ao gerar o relatório.';
      this.log.error(`Agendamento "${schedule.name}" falhou: ${detalhe}`);
    }

    this.metrics.increment(
      status === 'ENVIADO' ? 'relatorios.enviados' : 'relatorios.falhas',
    );

    return this.prisma.reportDelivery.create({
      data: {
        scheduleId: schedule.id,
        // Copiados para a linha: a entrega continua legivel depois que o
        // agendamento for removido (a FK vira NULL, a evidencia fica).
        scheduleName: schedule.name,
        report: schedule.report,
        runAt,
        status,
        channel: schedule.channel,
        // Trilha guarda o destinatario MASCARADO: provar que saiu para o
        // endereco certo nao exige reconstituir o endereco.
        recipient: maskRecipient(schedule.recipient),
        periodFrom: period.from,
        periodTo: period.to,
        rows,
        bytes,
        error,
      },
    });
  }

  // ----------------------------------------------------------------- Apoio

  private assertShape(s: {
    frequency: string;
    weekday?: number | null;
    monthday?: number | null;
    report: string;
  }) {
    if (!isExportable(s.report)) {
      throw new BadRequestException(`Relatório desconhecido: ${s.report}.`);
    }
    if (s.frequency === 'SEMANAL' && (s.weekday ?? null) === null) {
      throw new BadRequestException('Informe o dia da semana.');
    }
    if (s.frequency === 'MENSAL' && (s.monthday ?? null) === null) {
      throw new BadRequestException('Informe o dia do mes.');
    }
  }

  /** Nunca devolve o destinatario em claro para a listagem. */
  private present(
    schedule: ReportSchedule,
    extra?: { createdBy?: { id: string; name: string } | null; deliveries?: unknown[] },
  ) {
    // `recipient` sai em claro; `deliveries`/`createdBy` podem vir embutidos na
    // linha quando o chamador passa o proprio registro como `extra` — nao devem
    // reaparecer cruas alem de `ultimaEntrega`/`entregas`/`criadoPor`.
    const { recipient, deliveries, createdBy, ...rest } = schedule as ReportSchedule & {
      deliveries?: unknown[];
      createdBy?: { id: string; name: string } | null;
    };
    void deliveries;
    void createdBy;
    return {
      ...rest,
      recipientMascarado: maskRecipient(recipient),
      criadoPor: extra?.createdBy ?? null,
      ultimaEntrega: extra?.deliveries?.[0] ?? null,
    };
  }

  private record(action: string, actorId: string, schedule: ReportSchedule) {
    return this.authorization.record({
      action,
      actorId,
      targetType: 'ReportSchedule',
      targetId: schedule.id,
      detail: {
        relatorio: schedule.report,
        canal: schedule.channel,
        destinatario: maskRecipient(schedule.recipient),
        frequencia: schedule.frequency,
      },
    });
  }
}
