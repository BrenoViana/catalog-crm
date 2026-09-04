/**
 * Catalogo de permissoes do sistema.
 *
 * E a UNICA fonte de verdade sobre "o que existe para permitir". As linhas sao
 * sincronizadas para a tabela Permission a cada boot (AccessService.syncCatalog),
 * de modo que a tela de Usuarios & permissoes sempre lista o conjunto atual sem
 * precisar de migracao nova a cada permissao adicionada.
 *
 * O que fica NO BANCO e mutavel pelo administrador: quais permissoes cada papel
 * tem, quais papeis existem alem dos internos e as excecoes por usuario.
 */

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description?: string;
}

export const PERMISSION_GROUPS = [
  'Vendas',
  'Caixa',
  'Catalogo',
  'Clientes',
  'Fiscal',
  'Gestao',
] as const;

export const PERMISSION_CATALOG: PermissionDef[] = [
  // ---------------------------------------------------------------- Vendas
  { key: 'sales.view', group: 'Vendas', label: 'Ver vendas', description: 'Consultar o histórico de vendas e seus itens.' },
  { key: 'sales.create', group: 'Vendas', label: 'Registrar venda', description: 'Operar o PDV e concluir vendas.' },
  { key: 'sales.cancel', group: 'Vendas', label: 'Cancelar venda', description: 'Cancelar uma venda concluída, estornando estoque e caixa.' },
  { key: 'sales.return', group: 'Vendas', label: 'Registrar devolução', description: 'Devolver itens de uma venda, total ou parcialmente.' },
  { key: 'sales.discountOverride', group: 'Vendas', label: 'Passar do teto de desconto', description: 'Conceder desconto acima do limite configurado para a loja.' },

  // ---------------------------------------------------------------- Caixa
  { key: 'cash.operate', group: 'Caixa', label: 'Abrir e fechar caixa', description: 'Abrir o próprio turno e fechá-lo com a contagem da gaveta.' },
  { key: 'cash.movement', group: 'Caixa', label: 'Sangria e suprimento', description: 'Registrar retirada e reforço de dinheiro no caixa.' },
  { key: 'cash.report', group: 'Caixa', label: 'Leitura X / fechamento Z', description: 'Ver o resumo do turno atual e os relatórios de fechamento.' },

  // ---------------------------------------------------------------- Catalogo
  { key: 'products.view', group: 'Catalogo', label: 'Ver produtos', description: 'Consultar o catálogo e buscar itens no PDV.' },
  { key: 'products.manage', group: 'Catalogo', label: 'Gerenciar produtos', description: 'Criar, editar e inativar produtos.' },
  { key: 'products.import', group: 'Catalogo', label: 'Importar catálogo', description: 'Carregar produtos em lote por CSV.' },
  { key: 'categories.manage', group: 'Catalogo', label: 'Gerenciar categorias', description: 'Criar, renomear e remover categorias.' },
  { key: 'inventory.view', group: 'Catalogo', label: 'Ver estoque', description: 'Consultar saldos, ruptura e movimentações.' },
  { key: 'inventory.adjust', group: 'Catalogo', label: 'Ajustar estoque', description: 'Lançar entrada, ajuste e perda de estoque.' },

  // ---------------------------------------------------------------- Clientes
  { key: 'customers.view', group: 'Clientes', label: 'Ver clientes', description: 'Consultar clientes, perfil e aniversariantes.' },
  { key: 'customers.manage', group: 'Clientes', label: 'Gerenciar clientes', description: 'Cadastrar e editar clientes, inclusive o cadastro rápido do PDV.' },

  // ---------------------------------------------------------------- Fiscal
  { key: 'fiscal.view', group: 'Fiscal', label: 'Ver documentos fiscais', description: 'Consultar a situação das NFC-e emitidas.' },
  { key: 'fiscal.emit', group: 'Fiscal', label: 'Reemitir NFC-e', description: 'Forçar a emissão de documentos pendentes ou rejeitados.' },
  { key: 'fiscal.cancel', group: 'Fiscal', label: 'Cancelar NFC-e', description: 'Cancelar um documento fiscal autorizado.' },

  // ---------------------------------------------------------------- Gestao
  { key: 'dashboard.view', group: 'Gestao', label: 'Ver dashboard', description: 'Acompanhar os indicadores da loja em tempo real.' },
  { key: 'settings.manage', group: 'Gestao', label: 'Configurações da loja', description: 'Editar dados do emitente, identidade visual e políticas.' },
  { key: 'users.manage', group: 'Gestao', label: 'Usuários e permissões', description: 'Criar usuários, definir papéis e ajustar permissões.' },
];

export const PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

/** Papeis internos criados no primeiro boot. Nao podem ser apagados. */
export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  /** '*' concede tudo, inclusive permissoes adicionadas no futuro. */
  permissions: string[] | '*';
}

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: 'ADMIN',
    name: 'Administrador',
    description: 'Acesso total, incluindo configurações da loja e permissões.',
    permissions: '*',
  },
  {
    key: 'GERENTE',
    name: 'Gerente',
    description: 'Opera o balcão e administra catálogo, estoque, clientes e fiscal.',
    permissions: [
      'sales.view', 'sales.create', 'sales.cancel', 'sales.return', 'sales.discountOverride',
      'cash.operate', 'cash.movement', 'cash.report',
      'products.view', 'products.manage', 'products.import', 'categories.manage',
      'inventory.view', 'inventory.adjust',
      'customers.view', 'customers.manage',
      'fiscal.view', 'fiscal.emit', 'fiscal.cancel',
      'dashboard.view',
    ],
  },
  {
    key: 'OPERADOR',
    name: 'Operador de caixa',
    description: 'Frente de caixa: vende, devolve e opera o próprio turno.',
    permissions: [
      'sales.view', 'sales.create', 'sales.return',
      'cash.operate', 'cash.movement', 'cash.report',
      'products.view', 'inventory.view',
      'customers.view', 'customers.manage',
      'fiscal.view',
    ],
  },
];

export const ADMIN_ROLE_KEY = 'ADMIN';
