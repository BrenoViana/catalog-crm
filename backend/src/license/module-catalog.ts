/**
 * Catalogo de modulos comercializaveis.
 *
 * E a UNICA fonte de verdade sobre o que se vende separado. Duas regras que
 * valem para sempre:
 *
 * 1. O NUCLEO nunca e bloqueado por licenca. Travar o caixa de uma loja porque
 *    o boleto atrasou e dano ao cliente final, nao pressao comercial — e a
 *    primeira coisa que faz um lojista arrancar o sistema e falar mal dele.
 * 2. Modulo novo nasce DESLIGADO para quem ja comprou. Uma chave emitida ontem
 *    nao lista um modulo que so existe hoje, entao `modulos` da chave e a
 *    lista fechada do que aquele cliente pagou.
 */

export type ModuleKey =
  | 'core'
  | 'fiscal'
  | 'promocoes'
  | 'financeiro'
  | 'relatorios'
  | 'escala';

export interface ModuleDef {
  key: ModuleKey;
  name: string;
  description: string;
  /** Nucleo: sempre ativo, nao entra em chave nem em gate. */
  core: boolean;
  /**
   * Permissoes que pertencem ao modulo. Serve para a UI esconder o que nao
   * esta licenciado e para o relatorio de "o que este cliente tem".
   */
  permissions: string[];
}

export const MODULE_CATALOG: ModuleDef[] = [
  {
    key: 'core',
    name: 'Núcleo',
    description:
      'Frente de caixa, controle de caixa, catálogo, estoque e clientes. ' +
      'O que faz a loja vender — nunca é bloqueado.',
    core: true,
    permissions: [
      'sales.view',
      'sales.create',
      'sales.cancel',
      'sales.return',
      'sales.discountOverride',
      'cash.operate',
      'cash.movement',
      'cash.report',
      'products.view',
      'products.manage',
      'products.import',
      'categories.manage',
      'inventory.view',
      'inventory.adjust',
      'customers.view',
      'customers.manage',
      'users.manage',
      'settings.manage',
    ],
  },
  {
    key: 'fiscal',
    name: 'Fiscal',
    description:
      'Emissão de NFC-e com provedor real, cancelamento e documentos fiscais.',
    core: false,
    permissions: ['fiscal.view', 'fiscal.emit', 'fiscal.cancel'],
  },
  {
    key: 'promocoes',
    name: 'Promoções & fidelidade',
    description:
      'Campanhas de desconto automático por produto, categoria ou catálogo, e ' +
      'o programa de fidelidade (cashback em R$ com resgate no PDV).',
    core: false,
    permissions: [
      'promotions.view',
      'promotions.manage',
      'loyalty.redeem',
      'loyalty.manage',
    ],
  },
  {
    key: 'financeiro',
    name: 'Financeiro',
    description:
      'Contas a receber e a pagar, fluxo de caixa e conciliação de cartões.',
    core: false,
    permissions: [
      'finance.view',
      'finance.receivables.manage',
      'finance.payables.manage',
    ],
  },
  {
    key: 'relatorios',
    name: 'Relatórios',
    description:
      'Relatórios por período, curva ABC, margem e exportação. O dashboard em ' +
      'tempo real fica aqui.',
    core: false,
    permissions: [
      'dashboard.view',
      'reports.view',
      'reports.export',
      'reports.schedule',
    ],
  },
  {
    key: 'escala',
    name: 'Escala',
    description: 'Multi-caixa consolidado, multi-loja e operação offline.',
    core: false,
    permissions: [],
  },
];

export const MODULE_BY_KEY = new Map(MODULE_CATALOG.map((m) => [m.key, m]));

/** Chaves que podem aparecer numa licenca (o nucleo nao entra). */
export const SELLABLE_MODULES = MODULE_CATALOG.filter((m) => !m.core).map(
  (m) => m.key,
);

export const CORE_MODULES = MODULE_CATALOG.filter((m) => m.core).map(
  (m) => m.key,
);

/** Permissoes que dependem de um modulo acessorio — usado pela UI. */
export function permissionsOfModules(modules: Iterable<ModuleKey>): Set<string> {
  const out = new Set<string>();
  for (const key of modules) {
    for (const p of MODULE_BY_KEY.get(key)?.permissions ?? []) out.add(p);
  }
  return out;
}
