import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateLicenseDto } from './dto/update-license.dto';
import {
  CORE_MODULES,
  MODULE_CATALOG,
  type ModuleKey,
} from './module-catalog';
import {
  diasParaVencer,
  verifyLicenseKey,
  type LicensePayload,
} from './license-key';

/**
 * Estado de licenca da instalacao.
 *
 * Politica, decidida com o dono do produto:
 * - O NUCLEO nunca depende de licenca. Sem chave, com chave invalida ou com
 *   chave vencida, a loja continua vendendo.
 * - Os modulos acessorios respondem ao gate.
 * - Chave VENCIDA nao vira "sem licenca" na hora: ha um periodo de tolerancia
 *   em que os acessorios seguem valendo com aviso, porque atraso de boleto nao
 *   pode virar loja parada no sabado de manha.
 */

/** Dias em que a chave vencida ainda libera os acessorios, com aviso. */
const TOLERANCIA_DIAS = 15;

export interface LicenseStatus {
  /** Ha chave valida (assinatura confere), mesmo que vencida. */
  licenciado: boolean;
  cliente: string;
  cnpj: string | null;
  /** Modulos efetivamente liberados agora — inclui sempre o nucleo. */
  modulos: ModuleKey[];
  expiraEm: string | null;
  diasParaVencer: number | null;
  /** 'ok' | 'a_vencer' | 'tolerancia' | 'expirada' | 'ausente' | 'invalida' */
  situacao: LicenseSituacao;
  /** Frase pronta para o banner do frontend. Vazia quando nao ha o que dizer. */
  aviso: string;
  /** Catalogo, para a tela de licenca mostrar o que existe e o que falta. */
  catalogo: {
    key: ModuleKey;
    name: string;
    description: string;
    core: boolean;
    ativo: boolean;
  }[];
}

export type LicenseSituacao =
  | 'ok'
  | 'a_vencer'
  | 'tolerancia'
  | 'expirada'
  | 'ausente'
  | 'invalida'
  | 'desenvolvimento';

@Injectable()
export class LicenseService {
  private readonly log = new Logger(LicenseService.name);

  /** Cache do ultimo estado calculado; invalidado ao trocar a chave. */
  private cache: { status: LicenseStatus; at: number } | null = null;
  private static readonly CACHE_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  private get publicKey(): string {
    return (process.env.LICENSE_PUBLIC_KEY ?? '').trim();
  }

  private get isDev(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  /** Chave crua guardada no banco, se houver. */
  private async storedKey() {
    return this.prisma.license.findFirst({
      where: { active: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  invalidate() {
    this.cache = null;
  }

  async status(): Promise<LicenseStatus> {
    if (this.cache && Date.now() - this.cache.at < LicenseService.CACHE_MS) {
      return this.cache.status;
    }
    const status = await this.compute();
    this.cache = { status, at: Date.now() };
    return status;
  }

  private montar(
    situacao: LicenseSituacao,
    aviso: string,
    modulos: ModuleKey[],
    payload?: LicensePayload,
  ): LicenseStatus {
    const ativos = new Set<ModuleKey>([...CORE_MODULES, ...modulos]);
    return {
      licenciado: situacao !== 'ausente' && situacao !== 'invalida',
      cliente: payload?.cliente ?? 'Sem licença',
      cnpj: payload?.cnpj ?? null,
      modulos: [...ativos],
      expiraEm: payload?.expiraEm ?? null,
      diasParaVencer: payload ? diasParaVencer(payload.expiraEm) : null,
      situacao,
      aviso,
      catalogo: MODULE_CATALOG.map((m) => ({
        key: m.key,
        name: m.name,
        description: m.description,
        core: m.core,
        ativo: ativos.has(m.key),
      })),
    };
  }

  private async compute(): Promise<LicenseStatus> {
    // Em desenvolvimento tudo liga, com o estado dito em voz alta na tela para
    // ninguem confundir maquina de dev com instalacao licenciada.
    if (this.isDev) {
      return this.montar(
        'desenvolvimento',
        'Ambiente de desenvolvimento: todos os módulos liberados sem licença.',
        MODULE_CATALOG.filter((m) => !m.core).map((m) => m.key),
      );
    }

    if (!this.publicKey) {
      this.log.warn(
        'LICENSE_PUBLIC_KEY ausente: apenas o núcleo será liberado. ' +
          'Configure a chave pública do fornecedor no ambiente.',
      );
      return this.montar(
        'ausente',
        'Instalação sem licença. O caixa funciona normalmente; os módulos ' +
          'adicionais estão indisponíveis.',
        [],
      );
    }

    const row = await this.storedKey();
    if (!row?.key) {
      return this.montar(
        'ausente',
        'Instalação sem licença. O caixa funciona normalmente; os módulos ' +
          'adicionais estão indisponíveis.',
        [],
      );
    }

    const result = verifyLicenseKey(row.key, this.publicKey);
    if (!result.ok) {
      this.log.error(`Licenca recusada: ${result.motivo}`);
      return this.montar(
        'invalida',
        `Licença inválida (${result.motivo}) O caixa segue funcionando; ` +
          'fale com o fornecedor para regularizar.',
        [],
      );
    }

    const { payload } = result;
    const dias = diasParaVencer(payload.expiraEm);

    if (!result.expirada) {
      const aviso =
        dias <= 10
          ? `Sua licença vence em ${dias} dia(s). Renove para não perder os módulos adicionais.`
          : '';
      return this.montar(dias <= 10 ? 'a_vencer' : 'ok', aviso, payload.modulos, payload);
    }

    // Vencida: tolerancia antes de cortar.
    if (-dias <= TOLERANCIA_DIAS) {
      return this.montar(
        'tolerancia',
        `Licença vencida há ${-dias} dia(s). Os módulos adicionais continuam ` +
          `ativos por mais ${TOLERANCIA_DIAS + dias} dia(s).`,
        payload.modulos,
        payload,
      );
    }

    return this.montar(
      'expirada',
      'Licença vencida. O caixa continua funcionando; os módulos adicionais ' +
        'foram desativados.',
      [],
      payload,
    );
  }

  /** O modulo esta liberado agora? Nucleo responde sempre `true`. */
  async allows(module: ModuleKey): Promise<boolean> {
    if ((CORE_MODULES as string[]).includes(module)) return true;
    const status = await this.status();
    return status.modulos.includes(module);
  }

  // --------------------------------------------------------------- escrita

  /**
   * Grava uma chave nova. Recusa antes de gravar: chave que nao verifica nao
   * entra no banco, senao o proximo boot fica com um estado invalido e o
   * suporte perde tempo procurando no lugar errado.
   */
  async update(dto: UpdateLicenseDto) {
    if (!this.publicKey && !this.isDev) {
      throw new BadRequestException(
        'Instalacao sem chave publica de licenca configurada (LICENSE_PUBLIC_KEY).',
      );
    }

    if (this.publicKey) {
      const result = verifyLicenseKey(dto.key, this.publicKey);
      if (!result.ok) {
        throw new BadRequestException(`Chave recusada: ${result.motivo}`);
      }
      await this.assertMesmoEmitente(result.payload.cnpj);
      dto = { ...dto, customer: dto.customer ?? result.payload.cliente };
    }

    // As duas escritas numa transacao: se a segunda falhasse sozinha nao
    // sobrava nenhuma linha `active: true`, e a instalacao ficava sem licenca
    // ate alguem redigitar a chave.
    const [, saved] = await this.prisma.$transaction([
      this.prisma.license.updateMany({
        where: { active: true },
        data: { active: false },
      }),
      this.prisma.license.upsert({
        where: { key: dto.key },
        update: { customer: dto.customer ?? 'Cliente', active: true },
        create: { key: dto.key, customer: dto.customer ?? 'Cliente', active: true },
      }),
    ]);

    this.invalidate();
    return { id: saved.id, customer: saved.customer, active: saved.active };
  }

  /**
   * A chave prova QUE o fornecedor assinou, nunca PARA QUEM. Sem amarrar ao
   * emitente, a chave de um cliente — que viaja por e-mail e print de tela, e e
   * legivel por design — licencia qualquer outra loja que a cole aqui.
   *
   * So compara quando os dois lados tem CNPJ: chave emitida sem CNPJ
   * (avaliacao, demonstracao) continua valendo em qualquer instalacao, de
   * proposito.
   */
  private async assertMesmoEmitente(cnpjDaChave?: string) {
    if (!cnpjDaChave) return;
    const store = await this.prisma.storeSettings.findFirst({
      select: { cnpj: true },
    });
    const so = (v?: string | null) => (v ?? '').replace(/\D/g, '');
    const daLoja = so(store?.cnpj);
    if (!daLoja) return;
    if (so(cnpjDaChave) !== daLoja) {
      throw new BadRequestException(
        'Esta chave foi emitida para outro CNPJ. Confira os dados do emitente ' +
          'em Configurações ou peça uma chave para esta loja.',
      );
    }
  }

  /** Compatibilidade com a tela antiga de Configuracoes. */
  async getCurrent() {
    const status = await this.status();
    const row = await this.storedKey();
    return {
      // A chave inteira nao volta para a tela: nao e segredo, mas tambem nao
      // ha razao para espalha-la em log de proxy e captura de tela.
      key: row?.key ? `${row.key.slice(0, 18)}…` : '',
      customer: status.cliente,
      active: status.licenciado,
      situacao: status.situacao,
      expiraEm: status.expiraEm,
      updatedAt: row?.updatedAt ?? new Date().toISOString(),
    };
  }
}
