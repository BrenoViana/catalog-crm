import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthorizationService } from '../access/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTerminalDto,
  UpdateTerminalDto,
} from './dto/terminal.dto';

/** Prisma client de transacao — o mesmo tipo que os outros services usam. */
type Tx = Prisma.TransactionClient;

/** Quantos nomes de terminal livres o boot tenta adotar de uma vez. */
const BACKFILL_LIMIT = 200;

/** Transforma um nome livre num codigo de terminal valido. */
function slugCode(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length >= 2 ? base : `TERMINAL-${base || 'X'}`.slice(0, 40);
}

@Injectable()
export class TerminalsService implements OnModuleInit {
  private readonly log = new Logger(TerminalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Adota os nomes de terminal que ja aparecem em vendas e turnos como cadastro
   * de verdade. Best-effort e re-executavel: nunca derruba o boot, e um nome
   * que nao casa simplesmente fica sem vinculo (o codigo trata `terminalId`
   * nulo como "terminal não registrado").
   */
  async onModuleInit() {
    try {
      await this.backfillFromFreeText();
    } catch (err) {
      this.log.error(
        `Falha ao adotar terminais dos registros existentes: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  private async backfillFromFreeText() {
    const [saleNames, sessionNames] = await Promise.all([
      this.prisma.sale.findMany({
        where: { terminal: { not: null }, terminalId: null },
        select: { terminal: true },
        distinct: ['terminal'],
        take: BACKFILL_LIMIT,
      }),
      this.prisma.cashSession.findMany({
        where: { terminal: { not: null }, terminalId: null },
        select: { terminal: true },
        distinct: ['terminal'],
        take: BACKFILL_LIMIT,
      }),
    ]);

    const names = new Set<string>();
    for (const row of [...saleNames, ...sessionNames]) {
      const trimmed = row.terminal?.trim();
      if (trimmed) names.add(trimmed);
    }
    if (names.size === 0) return;

    let adopted = 0;
    for (const name of names) {
      const existing = await this.prisma.terminal.findFirst({
        where: {
          OR: [
            { name: { equals: name, mode: 'insensitive' } },
            { code: { equals: slugCode(name), mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      const terminalId = existing
        ? existing.id
        : (await this.createWithUniqueCode(name)).id;

      const [sales, sessions] = await Promise.all([
        this.prisma.sale.updateMany({
          where: { terminal: name, terminalId: null },
          data: { terminalId },
        }),
        this.prisma.cashSession.updateMany({
          where: { terminal: name, terminalId: null },
          data: { terminalId },
        }),
      ]);
      if (!existing || sales.count || sessions.count) adopted++;
    }
    if (adopted > 0) {
      this.log.log(`Terminais adotados dos registros existentes: ${adopted}.`);
    }
  }

  /** Cria um terminal resolvendo colisao de codigo com sufixo numerico. */
  private async createWithUniqueCode(name: string) {
    const root = slugCode(name);
    for (let i = 0; i < 50; i++) {
      const code = i === 0 ? root : `${root}-${i + 1}`.slice(0, 40);
      const taken = await this.prisma.terminal.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!taken) {
        return this.prisma.terminal.create({ data: { code, name } });
      }
    }
    // Fallback improvavel: um sufixo baseado no relogio.
    return this.prisma.terminal.create({
      data: { code: `${root}-${Date.now() % 100000}`.slice(0, 40), name },
    });
  }

  // -------------------------------------------------------------------- CRUD

  list() {
    return this.prisma.terminal.findMany({
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
    });
  }

  async findOne(id: string) {
    const terminal = await this.prisma.terminal.findUnique({ where: { id } });
    if (!terminal) throw new NotFoundException('Terminal não encontrado.');
    return terminal;
  }

  async create(dto: CreateTerminalDto, userId: string) {
    const code = dto.code.trim().toUpperCase();
    const taken = await this.prisma.terminal.findUnique({
      where: { code },
      select: { id: true },
    });
    if (taken) {
      throw new BadRequestException(`Já existe um terminal com o código "${code}".`);
    }
    const contingency = await this.resolveContingencyShape(dto, null);
    const terminal = await this.prisma.terminal.create({
      data: { code, name: dto.name.trim(), ...contingency },
    });
    await this.record('terminals.create', userId, terminal.id, {
      codigo: code,
      serieContingencia: contingency.contingencySeries ?? null,
    });
    return terminal;
  }

  async update(id: string, dto: UpdateTerminalDto, userId: string) {
    const current = await this.findOne(id);
    const data: Prisma.TerminalUpdateInput = {};

    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase();
      if (code !== current.code) {
        const taken = await this.prisma.terminal.findUnique({
          where: { code },
          select: { id: true },
        });
        if (taken) {
          throw new BadRequestException(
            `Já existe um terminal com o código "${code}".`,
          );
        }
        data.code = code;
      }
    }
    if (dto.name !== undefined) data.name = dto.name.trim();

    const touchesContingency =
      dto.contingencySeries !== undefined ||
      dto.contingencyRangeStart !== undefined ||
      dto.contingencyRangeEnd !== undefined;
    if (touchesContingency) {
      const merged = {
        contingencySeries:
          dto.contingencySeries ?? current.contingencySeries ?? undefined,
        contingencyRangeStart:
          dto.contingencyRangeStart ?? current.contingencyRangeStart ?? undefined,
        contingencyRangeEnd:
          dto.contingencyRangeEnd ?? current.contingencyRangeEnd ?? undefined,
      };
      const contingency = await this.resolveContingencyShape(merged, current);
      Object.assign(data, contingency);
    }

    const terminal = await this.prisma.terminal.update({ where: { id }, data });
    await this.record('terminals.update', userId, id, {
      campos: Object.keys(data).sort(),
    });
    return terminal;
  }

  async setActive(id: string, active: boolean, userId: string) {
    await this.findOne(id);
    const terminal = await this.prisma.terminal.update({
      where: { id },
      data: { active },
    });
    await this.record(
      active ? 'terminals.activate' : 'terminals.deactivate',
      userId,
      id,
      { ativo: active },
    );
    return terminal;
  }

  // ------------------------------------------------------- Faixa de contingencia

  /**
   * Valida e normaliza a faixa de contingencia. Regras:
   * - os tres campos andam juntos (serie + inicio + fim) ou nenhum;
   * - inicio <= fim;
   * - a serie de contingencia e disjunta da serie normal da loja;
   * - a serie de contingencia e unica entre terminais;
   * - `contingencyNextNumber` comeca no inicio da faixa e nunca e rebobinado
   *   para tras do inicio.
   */
  private async resolveContingencyShape(
    dto: {
      contingencySeries?: number;
      contingencyRangeStart?: number;
      contingencyRangeEnd?: number;
    },
    current: {
      id: string;
      contingencySeries: number | null;
      contingencyRangeStart: number | null;
      contingencyNextNumber: number | null;
    } | null,
  ): Promise<{
    contingencySeries: number | null;
    contingencyRangeStart: number | null;
    contingencyRangeEnd: number | null;
    contingencyNextNumber: number | null;
  }> {
    const { contingencySeries, contingencyRangeStart, contingencyRangeEnd } = dto;
    const provided = [
      contingencySeries,
      contingencyRangeStart,
      contingencyRangeEnd,
    ].filter((v) => v !== undefined && v !== null);

    if (provided.length === 0) {
      return {
        contingencySeries: null,
        contingencyRangeStart: null,
        contingencyRangeEnd: null,
        contingencyNextNumber: null,
      };
    }
    if (provided.length !== 3) {
      throw new BadRequestException(
        'A faixa de contingência precisa de série, número inicial e número final juntos.',
      );
    }
    if ((contingencyRangeStart as number) > (contingencyRangeEnd as number)) {
      throw new BadRequestException(
        'O número inicial da faixa de contingência não pode ser maior que o final.',
      );
    }

    const store = await this.prisma.storeSettings.findFirst({
      select: { nfceSeries: true },
    });
    if (store && store.nfceSeries === contingencySeries) {
      throw new BadRequestException(
        'A série de contingência precisa ser diferente da série normal da NFC-e.',
      );
    }

    const clash = await this.prisma.terminal.findFirst({
      where: {
        contingencySeries: contingencySeries,
        ...(current ? { id: { not: current.id } } : {}),
      },
      select: { code: true },
    });
    if (clash) {
      throw new BadRequestException(
        `A série de contingência ${contingencySeries} já pertence ao terminal "${clash.code}".`,
      );
    }

    // O proximo numero comeca no inicio da faixa; num update, so avanca — nunca
    // volta para tras do que ja pode ter sido emitido.
    const keepNext =
      current?.contingencySeries === contingencySeries &&
      current?.contingencyNextNumber != null &&
      current.contingencyNextNumber >= (contingencyRangeStart as number);
    return {
      contingencySeries: contingencySeries as number,
      contingencyRangeStart: contingencyRangeStart as number,
      contingencyRangeEnd: contingencyRangeEnd as number,
      contingencyNextNumber: keepNext
        ? (current!.contingencyNextNumber as number)
        : (contingencyRangeStart as number),
    };
  }

  // ---------------------------------------------------- Resolucao para escrita

  /**
   * Resolve um terminal a partir do que o cliente mandou (codigo ou nome livre)
   * e devolve o id + o rotulo a gravar em `Sale.terminal` / `CashSession.terminal`.
   *
   * Casa por codigo exato; senao por nome (case-insensitive). Se nao existir e
   * houver um nome, cria um terminal ativo na hora — um PDV que nunca foi
   * cadastrado ainda ganha identidade estavel. Toca `lastSeenAt`.
   */
  async resolveForWrite(
    tx: Tx,
    input: { terminalCode?: string | null; terminalName?: string | null },
  ): Promise<{ terminalId: string | null; terminalLabel: string | null }> {
    const code = input.terminalCode?.trim().toUpperCase() || null;
    const name = input.terminalName?.trim() || null;
    if (!code && !name) return { terminalId: null, terminalLabel: null };

    let terminal = code
      ? await tx.terminal.findUnique({ where: { code } })
      : null;
    if (!terminal && name) {
      terminal = await tx.terminal.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });
    }
    if (!terminal) {
      const newCode = code ?? slugCode(name as string);
      const clash = await tx.terminal.findUnique({ where: { code: newCode } });
      terminal = clash
        ? clash
        : await tx.terminal.create({
            data: { code: newCode, name: name ?? newCode },
          });
    }

    await tx.terminal.update({
      where: { id: terminal.id },
      data: { lastSeenAt: new Date() },
    });
    return { terminalId: terminal.id, terminalLabel: terminal.name };
  }

  // ----------------------------------------------------------------- Auditoria

  private record(
    action: string,
    actorId: string,
    terminalId: string,
    detail: Record<string, unknown>,
  ) {
    return this.authorization.record({
      action,
      actorId,
      targetType: 'Terminal',
      targetId: terminalId,
      detail,
    });
  }
}
