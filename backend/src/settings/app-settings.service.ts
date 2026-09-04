import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SETTING_BY_KEY,
  SETTING_CATALOG,
  SETTING_KEYS,
  type SettingDef,
} from './setting-catalog';

/** Cache curto: a leitura acontece em caminhos quentes (guard de login, PDV). */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class AppSettingsService implements OnModuleInit {
  private readonly log = new Logger(AppSettingsService.name);
  private cache: { values: Map<string, unknown>; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.syncCatalog();
    } catch (err) {
      this.log.error(
        `Falha ao sincronizar as configuracoes: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Cria as linhas que faltam com o valor padrao; nunca sobrescreve o que existe. */
  async syncCatalog() {
    for (const def of SETTING_CATALOG) {
      await this.prisma.appSetting.upsert({
        where: { key: def.key },
        create: {
          key: def.key,
          value: def.default as never,
          group: def.group,
          label: def.label,
          description: def.description ?? null,
        },
        // Rotulos acompanham o catalogo; o VALOR e do administrador.
        update: {
          group: def.group,
          label: def.label,
          description: def.description ?? null,
        },
      });
    }
    await this.prisma.appSetting.deleteMany({ where: { key: { notIn: SETTING_KEYS } } });
    this.cache = null;
    this.log.log(`Configuracoes sincronizadas (${SETTING_KEYS.length} chaves).`);
  }

  private async values(): Promise<Map<string, unknown>> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.values;

    const rows = await this.prisma.appSetting.findMany({
      select: { key: true, value: true },
    });
    const values = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
    this.cache = { values, expiresAt: Date.now() + CACHE_TTL_MS };
    return values;
  }

  /** Valor tipado, caindo no padrao do catalogo se a linha nao existir. */
  async get<T = unknown>(key: string): Promise<T> {
    const def = SETTING_BY_KEY.get(key);
    const stored = (await this.values()).get(key);
    return (stored ?? def?.default) as T;
  }

  async getNumber(key: string): Promise<number> {
    const raw = await this.get(key);
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number(SETTING_BY_KEY.get(key)?.default ?? 0);
  }

  /** Catalogo + valor atual, agrupado, para a tela de configuracoes. */
  async list() {
    const values = await this.values();
    return SETTING_CATALOG.map((def) => ({
      ...def,
      value: values.get(def.key) ?? def.default,
    }));
  }

  /** Valores publicos que o frontend precisa para montar a UI. */
  async publicValues() {
    return {
      maxInstallments: await this.getNumber('sales.maxInstallments'),
      scanGapMs: await this.getNumber('sales.scanGapMs'),
      drawerLimit: await this.getNumber('cash.drawerLimit'),
    };
  }

  async update(key: string, value: unknown) {
    const def = SETTING_BY_KEY.get(key);
    if (!def) throw new NotFoundException(`Configuracao "${key}" nao existe.`);

    const parsed = this.coerce(def, value);
    await this.prisma.appSetting.update({ where: { key }, data: { value: parsed as never } });
    this.cache = null;
    return { key, value: parsed };
  }

  async updateMany(entries: { key: string; value: unknown }[]) {
    const out: { key: string; value: unknown }[] = [];
    for (const e of entries) out.push(await this.update(e.key, e.value));
    return out;
  }

  private coerce(def: SettingDef, value: unknown) {
    if (def.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(`"${def.label}" precisa ser um numero.`);
      }
      if (def.min != null && n < def.min) {
        throw new BadRequestException(`"${def.label}" nao pode ser menor que ${def.min}.`);
      }
      if (def.max != null && n > def.max) {
        throw new BadRequestException(`"${def.label}" nao pode ser maior que ${def.max}.`);
      }
      return n;
    }
    if (def.type === 'boolean') return Boolean(value);

    const s = String(value ?? '').trim();
    if (def.options && !def.options.includes(s)) {
      throw new BadRequestException(
        `"${def.label}" aceita apenas: ${def.options.join(', ')}.`,
      );
    }
    return s;
  }
}
