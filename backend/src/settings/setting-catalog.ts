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
    description: 'Duração da janela de contagem das tentativas de login.',
    type: 'number',
    default: 60_000,
    min: 1_000,
    max: 3_600_000,
  },
  {
    key: 'authorize.rateLimit.max',
    group: 'Seguranca',
    label: 'Tentativas de liberação de supervisor por janela',
    description:
      'Quantas vezes a senha de um supervisor pode ser tentada antes de bloquear. ' +
      'Uso legitimo e raro: mantenha baixo — a rota e um oráculo de senha.',
    type: 'number',
    default: 5,
    min: 1,
    max: 20,
  },
  {
    key: 'authorize.rateLimit.windowMs',
    group: 'Seguranca',
    label: 'Janela do bloqueio de liberação (ms)',
    description: 'Duração da janela de contagem das tentativas de liberação.',
    type: 'number',
    default: 300_000,
    min: 1_000,
    max: 3_600_000,
  },
  {
    key: 'sales.maxInstallments',
    group: 'Vendas',
    label: 'Parcelas maximas no crédito',
    description: 'Maior número de parcelas oferecido no PDV para pagamento em crédito.',
    type: 'number',
    default: 12,
    min: 1,
    max: 36,
  },
  {
    key: 'sales.scanGapMs',
    group: 'Vendas',
    label: 'Intervalo do leitor de código de barras (ms)',
    description: 'Tempo máximo entre teclas para o PDV tratar a digitação como leitura de scanner.',
    type: 'number',
    default: 60,
    min: 10,
    max: 500,
  },
  {
    key: 'fiscal.maxEmitAttempts',
    group: 'Fiscal',
    label: 'Tentativas de emissão da NFC-e',
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
    key: 'fiscal.contingencyStaleHours',
    group: 'Fiscal',
    label: 'Horas em contingência antes do alerta',
    description:
      'Documento fiscal parado em contingência acima deste tempo, ainda sem ' +
      'chegar a SEFAZ, vira alerta operacional.',
    type: 'number',
    default: 24,
    min: 1,
    max: 168,
  },
  {
    key: 'fiscal.simulateOutage',
    group: 'Fiscal',
    label: 'Simular SEFAZ inacessivel',
    description:
      'Somente com o provedor "fake": força falha de comunicação a cada emissão ' +
      'para exercitar a contingência. Um provedor real ignora este ajuste.',
    type: 'boolean',
    default: false,
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

  // ------------------------------------------------------------- Financeiro
  {
    key: 'finance.installmentIntervalDays',
    group: 'Financeiro',
    label: 'Intervalo entre parcelas do crediário (dias)',
    description:
      'Espaçamento entre os vencimentos das parcelas geradas por uma venda no crediário. ' +
      'A primeira parcela vence um intervalo depois da venda.',
    type: 'number',
    default: 30,
    min: 1,
    max: 365,
  },
  {
    key: 'finance.blockCreditWhenOverdue',
    group: 'Financeiro',
    label: 'Bloquear crediário com título vencido',
    description:
      'Recusa nova venda a prazo para cliente que já tem parcela vencida. ' +
      'Desligado, o vencido apenas consome o limite.',
    type: 'boolean',
    default: true,
  },

  // ------------------------------------------------------------- Fidelidade
  {
    key: 'loyalty.enabled',
    group: 'Fidelidade',
    label: 'Programa de fidelidade ativo',
    description:
      'Liga o cashback: venda com cliente identificado passa a gerar saldo, e o saldo ' +
      'pode ser resgatado como pagamento no PDV. Desligar não apaga saldo já acumulado.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'loyalty.cashbackPercent',
    group: 'Fidelidade',
    label: 'Cashback por venda (%)',
    description:
      'Percentual do valor efetivamente pago que vira saldo para o cliente. O que foi ' +
      'pago COM saldo não gera saldo novo.',
    type: 'number',
    default: 0,
    min: 0,
    max: 50,
  },
  {
    key: 'loyalty.minRedeem',
    group: 'Fidelidade',
    label: 'Resgate mínimo (R$)',
    description: 'Menor valor que o cliente pode usar de saldo numa venda.',
    type: 'number',
    default: 1,
    min: 0,
    max: 10_000,
  },
  {
    key: 'loyalty.maxRedeemPercent',
    group: 'Fidelidade',
    label: 'Teto de resgate por venda (%)',
    description:
      'Quanto do total da venda pode ser pago com saldo. 100 permite pagar a venda inteira.',
    type: 'number',
    default: 100,
    min: 1,
    max: 100,
  },
  {
    key: 'ops.maxShiftHours',
    group: 'Caixa',
    label: 'Horas maximas de turno aberto',
    description:
      'A partir daqui o turno vira alerta operacional. Caixa aberto a noite inteira ' +
      'e o cenário em que a gaveta muda de mão sem ninguem assinar a contagem.',
    type: 'number',
    default: 12,
    min: 1,
    // Teto baixo de proposito: acima de 24h o alerta deixaria de cobrir o caso
    // que ele existe para pegar — a gaveta esquecida aberta de um dia para o
    // outro (SEC-076).
    max: 24,
  },
  {
    key: 'ops.divergenceAlert',
    group: 'Caixa',
    label: 'Divergência de gaveta que vira alerta (R$)',
    description:
      'Diferença absoluta de fechamento a partir da qual o turno entra na lista de ' +
      'alertas. Erro de troco e centavos; divergência recorrente e outra coisa.',
    type: 'number',
    default: 20,
    min: 0,
    // Nenhuma loja de balcao acumula R$ 2.000 de divergencia em 30 dias sem que
    // isso seja o proprio problema: teto alto demais aqui desligaria o alerta
    // por configuracao (SEC-076).
    max: 2_000,
  },
];

export const SETTING_KEYS = SETTING_CATALOG.map((s) => s.key);

export const SETTING_BY_KEY = new Map(SETTING_CATALOG.map((s) => [s.key, s]));
