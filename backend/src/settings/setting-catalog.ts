/**
 * Catalogo de configuracoes do sistema.
 *
 * Tudo aqui deixa de ser constante no codigo e passa a viver na tabela
 * AppSetting: o valor padrao abaixo so e usado no primeiro boot (e como
 * fallback se a linha sumir). O administrador ajusta pela tela de
 * Configuracoes; o codigo le sempre via AppSettingsService.
 *
 * Dados do emitente, identidade visual e politica de desconto continuam em
 * StoreSettings — sao configuracao da LOJA, nao do sistema.
 */

export type SettingType = 'number' | 'string' | 'boolean';

export interface SettingDef {
  key: string;
  group: string;
  label: string;
  description?: string;
  type: SettingType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  options?: string[];
}

export const SETTING_CATALOG: SettingDef[] = [
  {
    key: 'login.rateLimit.max',
    group: 'Seguranca',
    label: 'Tentativas de login por janela',
    description: 'Quantas tentativas de login o mesmo IP pode fazer antes de ser bloqueado.',
    type: 'number',
    default: 10,
    min: 1,
    max: 1000,
  },
  {
    key: 'login.rateLimit.windowMs',
    group: 'Seguranca',
    label: 'Janela do bloqueio de login (ms)',
    description: 'Duracao da janela de contagem das tentativas de login.',
    type: 'number',
    default: 60_000,
    min: 1_000,
    max: 3_600_000,
  },
  {
    key: 'sales.maxInstallments',
    group: 'Vendas',
    label: 'Parcelas maximas no credito',
    description: 'Maior numero de parcelas oferecido no PDV para pagamento em credito.',
    type: 'number',
    default: 12,
    min: 1,
    max: 36,
  },
  {
    key: 'sales.scanGapMs',
    group: 'Vendas',
    label: 'Intervalo do leitor de codigo de barras (ms)',
    description: 'Tempo maximo entre teclas para o PDV tratar a digitacao como leitura de scanner.',
    type: 'number',
    default: 60,
    min: 10,
    max: 500,
  },
  {
    key: 'fiscal.maxEmitAttempts',
    group: 'Fiscal',
    label: 'Tentativas de emissao da NFC-e',
    description: 'Quantas vezes o sistema tenta emitir antes de desistir e marcar como rejeitada.',
    type: 'number',
    default: 5,
    min: 1,
    max: 20,
  },
  {
    key: 'fiscal.provider',
    group: 'Fiscal',
    label: 'Provedor fiscal',
    description: 'Integrador usado para emitir a NFC-e. "fake" simula a SEFAZ em homologacao.',
    type: 'string',
    default: 'fake',
    options: ['fake'],
  },
  {
    key: 'cash.drawerLimit',
    group: 'Caixa',
    label: 'Teto de dinheiro na gaveta (R$)',
    description: 'Acima deste valor o PDV sugere sangria. 0 desliga o aviso.',
    type: 'number',
    default: 0,
    min: 0,
    max: 1_000_000,
  },
];

export const SETTING_KEYS = SETTING_CATALOG.map((s) => s.key);

export const SETTING_BY_KEY = new Map(SETTING_CATALOG.map((s) => [s.key, s]));
