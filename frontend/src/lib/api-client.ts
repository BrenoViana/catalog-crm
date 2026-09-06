const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

export class ApiClient {
  private static getAuthToken(): string | null {
    return localStorage.getItem('catalog.token');
  }

  private static getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  static async request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const url = `${API_URL}${endpoint}`;
    const headers = { ...this.getHeaders(), ...options.headers };
    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('catalog.token');
        localStorage.removeItem('catalog.user');
        if (!location.pathname.startsWith('/login')) location.href = '/login';
      }
      const error = await response.json().catch(() => ({}));
      const message = Array.isArray(error.message) ? error.message.join(', ') : error.message;
      throw new Error(message || `Erro HTTP ${response.status}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json();
  }

  static get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }
  static post<T>(
    endpoint: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers,
    });
  }
  static patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
  }
  static put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
  }
  static delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  /**
   * Baixa um arquivo de uma rota autenticada.
   *
   * Não dá para apontar um `<a href>` para a API: o token vai no header
   * Authorization, não em cookie. Então buscamos o corpo com o mesmo cabeçalho
   * das outras chamadas e entregamos ao navegador como Blob. O nome do arquivo
   * vem do Content-Disposition que o servidor mandou.
   */
  static async download(endpoint: string, fallbackName: string): Promise<void> {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = Array.isArray(error.message) ? error.message.join(', ') : error.message;
      throw new Error(message || `Erro HTTP ${response.status}`);
    }

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = match?.[1] ?? fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------- Auth
export interface AuthUser {
  id: string;
  username: string;
  name: string;
  /** Papel legado (enum). Exibicao apenas — a autorizacao vem de `permissions`. */
  role: string;
  roleKey: string | null;
  roleName: string | null;
}
export interface AuthResponse {
  access_token: string;
  user: AuthUser;
  permissions: string[];
}
export const authApi = {
  login: (data: { username: string; password: string }) =>
    ApiClient.post<AuthResponse>('/auth/login', data),
};

// ---------------------------------------------------------------- Dashboard
export interface DashboardSummary {
  revenueToday: number;
  salesToday: number;
  averageTicket: number;
  itemsSoldToday: number;
  activeProducts: number;
  lowStockCount: number;
  cashOpen: boolean;
  openCashCount: number;
  openCashSessions: Array<{
    id: string;
    operatorId: string;
    operatorName: string;
    openedAt: string;
    expectedAmount: number;
  }>;
  salesLast7Days: Array<{ date: string; label: string; value: number }>;
  topProducts: Array<{ name: string; quantity: number; value: number }>;
  relationship: {
    newCustomersThisMonth: number;
    activeCustomers30d: number;
    identifiedSalesShare30d: number;
    salesInWindow30d: number;
  };
  paymentsByMethod: Array<{ method: string; value: number }>;
}
export const dashboardApi = {
  getSummary: () => ApiClient.get<DashboardSummary>('/dashboard/summary'),
};

// ---------------------------------------------------------------- Relatorios
export type ReportGroupBy = 'day' | 'week' | 'month';

/** Janela consultada. Datas em AAAA-MM-DD, no fuso da loja. */
export interface ReportRange {
  from: string;
  to: string;
  groupBy?: ReportGroupBy;
}

export interface ReportPeriod {
  from: string;
  to: string;
  dias: number;
  groupBy?: ReportGroupBy;
}

export interface SalesReport {
  periodo: ReportPeriod;
  totais: {
    receitaBruta: number;
    descontos: number;
    receitaLiquida: number;
    devolucoes: number;
    receitaFinal: number;
    vendas: number;
    ticketMedio: number;
    itens: number;
    itensPorVenda: number;
    canceladas: number;
  };
  /**
   * Parte da receita que a loja ainda não viu entrar: pagamento negado, pendente
   * ou parado no gateway numa venda já concluída. É a diferença entre a receita
   * daqui e o total da leitura X/Z, declarada em vez de escondida.
   */
  naoLiquidado: { valor: number; pagamentos: number };
  /** Variação contra a janela anterior de mesmo tamanho; `null` sem base de comparação. */
  comparacao: {
    receitaFinal: number | null;
    vendas: number | null;
    ticketMedio: number | null;
  };
  serie: Array<{
    key: string;
    label: string;
    receita: number;
    vendas: number;
    descontos: number;
    devolucoes: number;
  }>;
}

export interface PaymentsReport {
  periodo: ReportPeriod;
  total: number;
  linhas: Array<{
    method: PaymentMethod;
    valor: number;
    quantidade: number;
    participacao: number;
    ticketMedio: number;
  }>;
  recusados: Array<{
    method: PaymentMethod;
    status: PaymentStatus;
    valor: number;
    quantidade: number;
  }>;
}

export interface ProductsReport {
  periodo: ReportPeriod;
  total: number;
  /** A lista bateu no teto de linhas do servidor e vem cortada na cauda. */
  truncado: boolean;
  limite: number;
  /** A margem usa o custo ATUAL do produto — a venda não guarda snapshot de custo. */
  margemEstimada: boolean;
  produtosSemCusto: number;
  margemTotal: number;
  resumo: Array<{ curva: 'A' | 'B' | 'C'; produtos: number; receita: number; participacao: number }>;
  linhas: Array<{
    productId: string;
    sku: string;
    nome: string;
    categoria: string;
    quantidade: number;
    receita: number;
    descontos: number;
    custo: number | null;
    margem: number | null;
    margemPercentual: number | null;
    curva: 'A' | 'B' | 'C';
    participacao: number;
    participacaoAcumulada: number;
  }>;
}

export interface CategoriesReport {
  periodo: ReportPeriod;
  total: number;
  truncado: boolean;
  margemEstimada: boolean;
  produtosSemCusto: number;
  linhas: Array<{
    categoria: string;
    produtos: number;
    /** Produtos da categoria sem custo cadastrado: ficam fora da margem. */
    produtosSemCusto: number;
    quantidade: number;
    receita: number;
    margem: number;
    /** Receita apenas dos produtos com custo — denominador da margem. */
    receitaComCusto: number;
    /** `null` quando nenhum produto da categoria tem custo cadastrado. */
    margemPercentual: number | null;
    participacao: number;
  }>;
}

export interface OperatorsReport {
  periodo: ReportPeriod;
  total: number;
  linhas: Array<{
    operatorId: string;
    nome: string;
    vendas: number;
    receita: number;
    descontos: number;
    ticketMedio: number;
    participacao: number;
    canceladas: number;
  }>;
}

export interface InventoryReport {
  geradoEm: string;
  truncado: boolean;
  limite: number;
  totais: {
    produtos: number;
    unidades: number;
    valorCusto: number;
    valorVenda: number;
    emRuptura: number;
    zerados: number;
    semGiro90d: number;
    semCusto: number;
  };
  linhas: Array<{
    productId: string;
    sku: string;
    nome: string;
    categoria: string;
    quantidade: number;
    minimo: number;
    precoVenda: number;
    custoUnitario: number | null;
    valorCusto: number | null;
    valorVenda: number;
    ruptura: boolean;
    zerado: boolean;
    semGiro90d: boolean;
  }>;
}

export type ReportKey =
  | 'vendas'
  | 'pagamentos'
  | 'produtos'
  | 'categorias'
  | 'operadores'
  | 'estoque';

const reportQuery = (range: ReportRange) => {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (range.groupBy) params.set('groupBy', range.groupBy);
  return `?${params.toString()}`;
};

export const reportsApi = {
  sales: (range: ReportRange) =>
    ApiClient.get<SalesReport>(`/reports/sales${reportQuery(range)}`),
  payments: (range: ReportRange) =>
    ApiClient.get<PaymentsReport>(`/reports/payments${reportQuery(range)}`),
  products: (range: ReportRange) =>
    ApiClient.get<ProductsReport>(`/reports/products${reportQuery(range)}`),
  categories: (range: ReportRange) =>
    ApiClient.get<CategoriesReport>(`/reports/categories${reportQuery(range)}`),
  operators: (range: ReportRange) =>
    ApiClient.get<OperatorsReport>(`/reports/operators${reportQuery(range)}`),
  inventory: () => ApiClient.get<InventoryReport>('/reports/inventory'),
  exportCsv: (report: ReportKey, range: ReportRange) =>
    ApiClient.download(`/reports/export/${report}${reportQuery(range)}`, `${report}.csv`),
};

// ---------------------------------------------------------------- Categorias
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  _count?: { products: number; children: number };
}
export const categoriesApi = {
  list: () => ApiClient.get<Category[]>('/categories'),
  create: (data: { name: string; parentId?: string }) =>
    ApiClient.post<Category>('/categories', data),
  update: (id: string, data: { name: string; parentId?: string }) =>
    ApiClient.patch<Category>(`/categories/${id}`, data),
  remove: (id: string) => ApiClient.delete<{ message: string }>(`/categories/${id}`),
};

// ---------------------------------------------------------------- Produtos
export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  unit: string;
  pricingMode: 'UNIT' | 'WEIGHT';
  price: number;
  cost: number | null;
  active: boolean;
  categoryId: string | null;
  category?: Category | null;
  taxGroupId: string | null;
  stock?: { quantity: number; minQuantity: number } | null;
}
export interface CreateProductInput {
  sku: string;
  name: string;
  barcode?: string;
  description?: string;
  unit?: string;
  pricingMode?: 'UNIT' | 'WEIGHT';
  price: number;
  cost?: number;
  categoryId?: string;
  initialStock?: number;
  minStock?: number;
}
export const productsApi = {
  list: (params?: { search?: string; categoryId?: string; onlyActive?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.categoryId) q.set('categoryId', params.categoryId);
    if (params?.onlyActive) q.set('onlyActive', 'true');
    const qs = q.toString();
    return ApiClient.get<Product[]>(`/products${qs ? `?${qs}` : ''}`);
  },
  byCode: (code: string) => ApiClient.get<Product>(`/products/by-code/${encodeURIComponent(code)}`),
  create: (data: CreateProductInput) => ApiClient.post<Product>('/products', data),
  update: (id: string, data: Partial<CreateProductInput> & { active?: boolean }) =>
    ApiClient.patch<Product>(`/products/${id}`, data),
  remove: (id: string) => ApiClient.delete<{ message: string }>(`/products/${id}`),
  importCsv: (csv: string, createCategories = true) =>
    ApiClient.post<ImportResult>('/products/import', { csv, createCategories }),
};

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
  rows: Array<{
    line: number;
    sku: string;
    action: 'created' | 'updated' | 'error';
    message?: string;
  }>;
}

// ---------------------------------------------------------------- Estoque
export interface StockRow {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  category: string | null;
  quantity: number;
  minQuantity: number;
  low: boolean;
  updatedAt: string;
}
export const inventoryApi = {
  list: () => ApiClient.get<StockRow[]>('/inventory'),
  lowStock: () => ApiClient.get<StockRow[]>('/inventory/low-stock'),
  movements: (productId?: string) =>
    ApiClient.get<any[]>(`/inventory/movements${productId ? `?productId=${productId}` : ''}`),
  adjust: (data: { productId: string; type: 'ENTRADA' | 'AJUSTE' | 'PERDA'; quantity: number; reason?: string }) =>
    ApiClient.post('/inventory/adjust', data),
};

// ---------------------------------------------------------------- Clientes
export interface Customer {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
  /** Teto de crediário do cliente. 0 = não compra a prazo. */
  creditLimit?: number;
  createdAt: string;
}
export type CustomerSegment = 'NOVO' | 'VIP' | 'ATIVO' | 'EM_RISCO' | 'INATIVO';

/** Item da lista de clientes para gerência: cliente + resumo de compras. */
export interface CustomerListItem extends Customer {
  salesCount: number;
  totalSpent: number;
  lastPurchase: string | null;
  segment: CustomerSegment;
}

export interface CustomerProfile {
  customer: Customer;
  stats: {
    salesCount: number;
    totalSpent: number;
    averageTicket: number;
    firstPurchase: string | null;
    lastPurchase: string | null;
    segment: CustomerSegment;
  };
  recentSales: Array<{
    id: string;
    number: number;
    status: Sale['status'];
    total: number;
    createdAt: string;
    completedAt: string | null;
    _count: { items: number };
  }>;
  topProducts: Array<{ name: string; quantity: number; total: number }>;
}

export interface BirthdayCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthDate: string;
}

export const customersApi = {
  list: (search?: string) =>
    ApiClient.get<CustomerListItem[]>(
      `/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    ),
  getProfile: (id: string) => ApiClient.get<CustomerProfile>(`/customers/${id}/profile`),
  birthdays: (month?: number) =>
    ApiClient.get<BirthdayCustomer[]>(
      `/customers/birthdays${month ? `?month=${month}` : ''}`,
    ),
  create: (data: Partial<Customer>) => ApiClient.post<Customer>('/customers', data),
  update: (id: string, data: Partial<Customer>) => ApiClient.patch<Customer>(`/customers/${id}`, data),
  remove: (id: string) => ApiClient.delete<{ message: string }>(`/customers/${id}`),
};

// ---------------------------------------------------------------- Vendas / PDV
export type PaymentMethod =
  | 'DINHEIRO'
  | 'PIX'
  | 'DEBITO'
  | 'CREDITO'
  | 'CREDIARIO'
  | 'OUTRO'
  /** Resgate do saldo de fidelidade do cliente. */
  | 'FIDELIDADE';

export type PaymentStatus =
  | 'PENDENTE'
  | 'PROCESSANDO'
  | 'AUTORIZADO'
  | 'CONFIRMADO'
  | 'NEGADO'
  | 'ESTORNADO';

/** Pagamento com o que a porta de pagamento devolveu (gateway). */
export interface Payment {
  id: string;
  saleId?: string;
  method: PaymentMethod;
  amount: number;
  installments: number | null;
  status: PaymentStatus;
  provider: string | null;
  authorizationCode: string | null;
  qrCode: string | null;
  rejectionReason: string | null;
  authorizedAt: string | null;
  refundedAt: string | null;
  createdAt?: string;
}
export interface SaleItem {
  id: string;
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}
export interface Sale {
  id: string;
  number: number;
  status: 'ABERTA' | 'CONCLUIDA' | 'CANCELADA';
  subtotal: number;
  discount: number;
  total: number;
  note: string | null;
  terminal: string | null;
  createdAt: string;
  completedAt: string | null;
  customer?: Customer | null;
  operator?: { id: string; name: string };
  items?: SaleItem[];
  payments?: Payment[];
  fiscalDocument?: FiscalDocument | null;
  returns?: SaleReturn[];
  _count?: { items: number };
}

export type FiscalStatus =
  | 'NAO_EMITIDA'
  | 'PENDENTE'
  | 'PROCESSANDO'
  | 'AUTORIZADA'
  | 'REJEITADA'
  | 'CANCELADA'
  | 'CONTINGENCIA';

export interface FiscalDocument {
  id: string;
  saleId: string;
  model: number;
  series: number;
  number: number;
  status: FiscalStatus;
  environment: string;
  provider: string | null;
  accessKey: string | null;
  protocol: string | null;
  qrCode: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  rejectionReason: string | null;
  attempts: number;
  issuedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  sale?: { id: string; number: number; total: number; status?: Sale['status'] };
}
export interface CreateSaleInput {
  items: Array<{ productId: string; quantity: number; unitPrice?: number; discount?: number }>;
  payments: Array<{ method: PaymentMethod; amount: number; installments?: number }>;
  customerId?: string;
  discount?: number;
  note?: string;
  terminal?: string;
}

export interface SaleReturnItem {
  id: string;
  saleItemId: string;
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}
export interface SaleReturn {
  id: string;
  number: number;
  saleId: string;
  reason: string;
  refundMethod: PaymentMethod;
  total: number;
  cashSessionId: string | null;
  createdAt: string;
  items: SaleReturnItem[];
  operator?: { id: string; name: string };
}
export interface CreateReturnInput {
  items: Array<{ saleItemId: string; quantity: number }>;
  reason: string;
  refundMethod: PaymentMethod;
}

/** Vale de supervisor: viaja no header e vale para uma operação só. */
const grantHeader = (grant?: string) =>
  grant ? { 'X-Authorization-Grant': grant } : undefined;

export interface PromotionSimulationLine {
  index: number;
  productId: string;
  discount: number;
  promotionId: string;
  promotionName: string;
}

export interface PromotionSimulation {
  total: number;
  lines: PromotionSimulationLine[];
}

export type PromotionKind =
  | 'PERCENT'
  | 'AMOUNT'
  | 'FIXED_PRICE'
  | 'BUY_X_PAY_Y';
export type PromotionScope = 'PRODUCT' | 'CATEGORY' | 'ALL';

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  kind: PromotionKind;
  scope: PromotionScope;
  productId: string | null;
  categoryId: string | null;
  product?: { id: string; name: string; sku: string } | null;
  category?: { id: string; name: string } | null;
  value: number | null;
  buyQty: number | null;
  payQty: number | null;
  minQuantity: number | null;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
}

/** Corpo aceito na criacao; no PATCH todos os campos sao opcionais. */
export interface PromotionInput {
  name?: string;
  description?: string;
  kind?: PromotionKind;
  scope?: PromotionScope;
  productId?: string;
  categoryId?: string;
  value?: number;
  buyQty?: number;
  payQty?: number;
  /** `null` limpa o campo; ausente mantém o que está. */
  minQuantity?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  active?: boolean;
}

export const promotionsApi = {
  list: () => ApiClient.get<Promotion[]>('/promotions'),
  create: (data: PromotionInput) =>
    ApiClient.post<Promotion>('/promotions', data),
  /** PATCH parcial: o que nao for enviado fica como esta. */
  update: (id: string, data: PromotionInput) =>
    ApiClient.patch<Promotion>(`/promotions/${id}`, data),
  remove: (id: string) => ApiClient.delete<{ id: string }>(`/promotions/${id}`),
  /**
   * Simula o desconto automatico do carrinho. E so para MOSTRAR ao cliente: o
   * valor que vale e o que o servidor recalcula ao fechar a venda.
   */
  simulate: (items: { productId: string; quantity: number }[]) =>
    ApiClient.post<PromotionSimulation>('/promotions/simulate', { items }),
};

export const salesApi = {
  list: (status?: string) =>
    ApiClient.get<Sale[]>(`/sales${status ? `?status=${status}` : ''}`),
  get: (id: string) => ApiClient.get<Sale>(`/sales/${id}`),
  create: (data: CreateSaleInput, grant?: string) =>
    ApiClient.post<Sale>('/sales', data, grantHeader(grant)),
  cancel: (id: string, reason: string, grant?: string) =>
    ApiClient.post<Sale>(`/sales/${id}/cancel`, { reason }, grantHeader(grant)),
  returns: (id: string) => ApiClient.get<SaleReturn[]>(`/sales/${id}/returns`),
  createReturn: (id: string, data: CreateReturnInput, grant?: string) =>
    ApiClient.post<SaleReturn>(`/sales/${id}/returns`, data, grantHeader(grant)),
};

// ---------------------------------------------------------------- Fiscal (NFC-e)
export const fiscalApi = {
  list: (status?: string) =>
    ApiClient.get<FiscalDocument[]>(`/fiscal/documents${status ? `?status=${status}` : ''}`),
  get: (id: string) => ApiClient.get<FiscalDocument>(`/fiscal/documents/${id}`),
  emit: (id: string) => ApiClient.post<FiscalDocument>(`/fiscal/documents/${id}/emit`),
  cancel: (id: string, reason: string) =>
    ApiClient.post<FiscalDocument>(`/fiscal/documents/${id}/cancel`, { reason }),
  processPending: () =>
    ApiClient.post<{ picked: number; authorized: number; rejected: number }>(
      '/fiscal/process-pending',
    ),
};

// ---------------------------------------------------------------- Caixa
/** Teto de dinheiro na gaveta (AppSetting `cash.drawerLimit`). limit 0 = desligado. */
export interface DrawerStatus {
  limit: number;
  cashOnHand: number;
  exceeded: boolean;
  suggestedWithdrawal: number;
}
export interface CashSession {
  id: string;
  status: 'ABERTA' | 'FECHADA';
  terminal: string | null;
  openingAmount: number;
  openedAt: string;
  closedAt: string | null;
  closingCountedAmount: number | null;
  closingExpectedAmount: number | null;
  difference: number | null;
  expectedAmount?: number;
  drawer?: DrawerStatus;
  movements: Array<{ id: string; type: string; amount: number; reason: string | null; createdAt: string }>;
}
export interface CashReport {
  kind: 'X' | 'Z';
  generatedAt: string;
  session: {
    id: string;
    status: 'ABERTA' | 'FECHADA';
    terminal: string | null;
    openedAt: string;
    closedAt: string | null;
    openingAmount: number;
    notes: string | null;
  };
  operator: { id: string; name: string } | null;
  sales: { count: number; total: number; discountTotal: number; canceledCount: number };
  byPaymentMethod: Array<{ method: PaymentMethod; count: number; amount: number }>;
  /** Pagamentos sem desfecho ou recusados no turno — não entram no recebido. */
  unsettledPayments: Array<{ status: PaymentStatus; count: number; amount: number }>;
  cash: {
    opening: number;
    sales: number;
    suprimentos: number;
    sangrias: number;
    expected: number;
    counted: number | null;
    difference: number | null;
  };
  drawer: DrawerStatus | null;
}

/** Um turno dentro do consolidado multi-caixa. */
export interface ConsolidatedSession {
  id: string;
  terminal: string | null;
  operator: { id: string; name: string };
  status: 'ABERTA' | 'FECHADA';
  openedAt: string;
  closedAt: string | null;
  opening: number;
  cashSales: number;
  suprimentos: number;
  sangrias: number;
  expected: number;
  counted: number | null;
  /** `null` enquanto o turno estiver aberto: a gaveta ainda não foi contada. */
  difference: number | null;
  salesCount: number;
  salesTotal: number;
  canceledCount: number;
}

/** Recorte do consolidado por terminal ou por operador. */
export interface ConsolidatedGroup {
  key: string;
  sessions: number;
  openSessions: number;
  salesCount: number;
  salesTotal: number;
  expected: number;
  counted: number;
  difference: number;
}

export interface CashConsolidated {
  period: { from: string; to: string; fromLabel: string; toLabel: string; days: number };
  totals: {
    sessions: number;
    openSessions: number;
    closedSessions: number;
    terminals: number;
    operators: number;
    salesCount: number;
    salesTotal: number;
    canceledCount: number;
    discountTotal: number;
    opening: number;
    cashSales: number;
    suprimentos: number;
    sangrias: number;
    expected: number;
    counted: number;
    difference: number;
  };
  byPaymentMethod: Array<{ method: PaymentMethod; count: number; amount: number }>;
  unsettledPayments: Array<{ status: PaymentStatus; count: number; amount: number }>;
  byTerminal: ConsolidatedGroup[];
  byOperator: ConsolidatedGroup[];
  sessions: ConsolidatedSession[];
  divergences: ConsolidatedSession[];
  openSessionIds: string[];
}

export const cashApi = {
  current: () => ApiClient.get<CashSession | null>('/cash/current'),
  history: () => ApiClient.get<CashSession[]>('/cash/history'),
  report: () => ApiClient.get<CashReport>('/cash/report'),
  reportFor: (sessionId: string) => ApiClient.get<CashReport>(`/cash/report/${sessionId}`),
  open: (openingAmount: number, notes?: string, terminal?: string) =>
    ApiClient.post<CashSession>('/cash/open', { openingAmount, notes, terminal }),
  movement: (type: 'SANGRIA' | 'SUPRIMENTO', amount: number, reason?: string) =>
    ApiClient.post<CashSession>('/cash/movement', { type, amount, reason }),
  close: (countedAmount: number, notes?: string) =>
    ApiClient.post<CashSession>('/cash/close', { countedAmount, notes }),
  consolidated: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return ApiClient.get<CashConsolidated>(`/cash/consolidated${qs ? `?${qs}` : ''}`);
  },
};

// -------------------------------------------------------------- Operacional
export type AlertLevel = 'alto' | 'medio' | 'baixo';

export interface OpsAlert {
  code: string;
  level: AlertLevel;
  title: string;
  detail: string;
  link?: string;
  data?: Record<string, string | number>;
}

export const opsApi = {
  alerts: () =>
    ApiClient.get<{ generatedAt: string; alerts: OpsAlert[] }>('/ops/alerts'),
};

// ---------------------------------------------------------------- Pagamentos
export const paymentsApi = {
  gateways: () =>
    ApiClient.get<Array<{ name: string; methods: PaymentMethod[] }>>('/payments/gateways'),
  forSale: (saleId: string) => ApiClient.get<Payment[]>(`/payments/sale/${saleId}`),
};

// ---------------------------------------------------------------- Config da loja / licença
export interface StoreSettings {
  id: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  ie: string | null;
  im: string | null;
  taxRegime: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string | null;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  phone: string | null;
  email: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  nfceEnvironment: string;
  hasFiscalToken?: boolean;
  hasCsc?: boolean;
  /** Teto de desconto (%) que um OPERADOR concede sem liberação de gerente. */
  maxDiscountPercentOperator: number;
}
export interface StoreBranding {
  tradeName: string | null;
  legalName: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
}
export const storeSettingsApi = {
  get: () => ApiClient.get<StoreSettings | null>('/store-settings'),
  branding: () => ApiClient.get<StoreBranding>('/store-settings/branding'),
  update: (data: Partial<StoreSettings>) => ApiClient.put<StoreSettings>('/store-settings', data),
};

export interface LicenseInfo {
  key: string;
  customer: string;
  active: boolean;
  updatedAt: string;
}
export type ModuleKey =
  | 'core'
  | 'fiscal'
  | 'promocoes'
  | 'financeiro'
  | 'relatorios'
  | 'escala';

export type LicenseSituacao =
  | 'ok'
  | 'a_vencer'
  | 'tolerancia'
  | 'expirada'
  | 'ausente'
  | 'invalida'
  | 'desenvolvimento';

export interface LicenseStatus {
  licenciado: boolean;
  cliente: string;
  cnpj: string | null;
  modulos: ModuleKey[];
  expiraEm: string | null;
  diasParaVencer: number | null;
  situacao: LicenseSituacao;
  aviso: string;
  catalogo: {
    key: ModuleKey;
    name: string;
    description: string;
    core: boolean;
    ativo: boolean;
  }[];
}

export const licenseApi = {
  get: () => ApiClient.get<LicenseInfo>('/settings/license'),
  update: (key: string, customer?: string) =>
    ApiClient.put<LicenseInfo>('/settings/license', { key, customer }),
  /** Modulos ativos e aviso de vencimento. Qualquer autenticado le. */
  status: () => ApiClient.get<LicenseStatus>('/license/status'),
  renovar: () =>
    ApiClient.post<{ resultado: string; status: LicenseStatus }>(
      '/settings/license/renovar',
      {},
    ),
};


// ---------------------------------------------------------------- Acesso (RBAC)
export interface Permission {
  key: string;
  group: string;
  label: string;
  description: string | null;
  sortOrder: number;
}

export interface AccessRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  system: boolean;
  permissions: Array<{ permissionKey: string }>;
  _count?: { users: number };
}

export interface AccessUser {
  id: string;
  username: string;
  name: string;
  active: boolean;
  createdAt: string;
  roleId: string | null;
  accessRole: { id: string; key: string; name: string; system: boolean } | null;
  overrides: Array<{ permissionKey: string; allow: boolean }>;
}

export const accessApi = {
  me: () => ApiClient.get<{ permissions: string[] }>('/access/me'),
  permissions: () => ApiClient.get<Permission[]>('/access/permissions'),
  roles: () => ApiClient.get<AccessRole[]>('/access/roles'),
  createRole: (data: { key: string; name: string; description?: string; permissions: string[] }) =>
    ApiClient.post<AccessRole>('/access/roles', data),
  updateRole: (
    id: string,
    data: { name?: string; description?: string; permissions?: string[] },
  ) => ApiClient.patch<AccessRole>(`/access/roles/${id}`, data),
  removeRole: (id: string) => ApiClient.delete<{ message: string }>(`/access/roles/${id}`),
  users: () => ApiClient.get<AccessUser[]>('/access/users'),
  createUser: (data: {
    username: string;
    name: string;
    password: string;
    roleId: string;
    active?: boolean;
  }) => ApiClient.post<AccessUser>('/access/users', data),
  updateUser: (id: string, data: { name?: string; username?: string }) =>
    ApiClient.patch<AccessUser>(`/access/users/${id}`, data),
  setUserPassword: (id: string, data: { password: string; currentPassword?: string }) =>
    ApiClient.put<{ message: string }>(`/access/users/${id}/password`, data),
  setOwnPassword: (data: { password: string; currentPassword: string }) =>
    ApiClient.put<{ message: string }>('/access/me/password', data),
  setUserRole: (id: string, roleId: string) =>
    ApiClient.put<{ id: string; roleId: string }>(`/access/users/${id}/role`, { roleId }),
  setUserOverrides: (id: string, overrides: Array<{ permissionKey: string; allow: boolean }>) =>
    ApiClient.put(`/access/users/${id}/overrides`, { overrides }),
  setUserActive: (id: string, active: boolean) =>
    ApiClient.put(`/access/users/${id}/active`, { active }),

  /** Pede a liberação de um supervisor para uma permissão específica. */
  authorize: (data: {
    username: string;
    password: string;
    permission: string;
    reason?: string;
  }) =>
    ApiClient.post<{
      token: string;
      permission: string;
      expiresInSeconds: number;
      approver: { id: string; name: string };
    }>('/access/authorize', data),

  audit: (params?: { action?: string; take?: number }) => {
    const q = new URLSearchParams();
    if (params?.action) q.set('action', params.action);
    if (params?.take) q.set('take', String(params.take));
    const qs = q.toString();
    return ApiClient.get<AuditEntry[]>(`/access/audit${qs ? `?${qs}` : ''}`);
  },
};

export interface AuditEntry {
  id: string;
  action: string;
  permissionKey: string | null;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string; username: string };
  approver: { id: string; name: string; username: string } | null;
}

// ---------------------------------------------------------------- Configuracoes do sistema
export interface AppSettingRow {
  key: string;
  group: string;
  label: string;
  description?: string;
  type: 'number' | 'string' | 'boolean';
  value: number | string | boolean;
  min?: number;
  max?: number;
  options?: string[];
}

/** Valores que a interface precisa para se montar, sem exigir settings.manage. */
export interface PublicSettings {
  maxInstallments: number;
  scanGapMs: number;
  drawerLimit: number;
  installmentIntervalDays: number;
  loyalty: {
    enabled: boolean;
    cashbackPercent: number;
    minRedeem: number;
    maxRedeemPercent: number;
  };
}

export const appSettingsApi = {
  list: () => ApiClient.get<AppSettingRow[]>('/app-settings'),
  publicValues: () => ApiClient.get<PublicSettings>('/app-settings/public'),
  update: (settings: Array<{ key: string; value: unknown }>) =>
    ApiClient.put<Array<{ key: string; value: unknown }>>('/app-settings', { settings }),
};

// ------------------------------------------------------------------ Fidelidade
export type LoyaltyEntryType = 'ACUMULO' | 'RESGATE' | 'AJUSTE' | 'ESTORNO';

export interface LoyaltyEntry {
  id: string;
  type: LoyaltyEntryType;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: string;
  sale: { id: string; number: number } | null;
  user: { id: string; name: string } | null;
}

export interface LoyaltyStatement {
  balance: number;
  earned: number;
  redeemed: number;
  entries: LoyaltyEntry[];
}

export interface LoyaltyConfig {
  enabled: boolean;
  cashbackPercent: number;
  minRedeem: number;
  maxRedeemPercent: number;
}

export const loyaltyApi = {
  config: () => ApiClient.get<LoyaltyConfig>('/loyalty/config'),
  statement: (customerId: string) =>
    ApiClient.get<LoyaltyStatement>(`/loyalty/${customerId}`),
  adjust: (customerId: string, amount: number, reason: string) =>
    ApiClient.post<{ balance: number }>(`/loyalty/${customerId}/adjust`, {
      amount,
      reason,
    }),
};

// ------------------------------------------------------------------ Financeiro
export type TitleStatus = 'ABERTO' | 'PARCIAL' | 'PAGO' | 'CANCELADO';

export type PayableRecurrence =
  | 'NENHUMA'
  | 'SEMANAL'
  | 'MENSAL'
  | 'BIMESTRAL'
  | 'TRIMESTRAL'
  | 'SEMESTRAL'
  | 'ANUAL';

export interface TitleSettlement {
  id: string;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

export interface Receivable {
  id: string;
  number: number;
  description: string;
  installment: number;
  installments: number;
  amount: number;
  paidAmount: number;
  dueDate: string;
  status: TitleStatus;
  paidAt: string | null;
  note: string | null;
  customer: { id: string; name: string; phone: string | null };
  sale: { id: string; number: number } | null;
  settlements: TitleSettlement[];
}

export interface Supplier {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
}

export interface Payable {
  id: string;
  number: number;
  description: string;
  category: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
  status: TitleStatus;
  recurrence: PayableRecurrence;
  paidAt: string | null;
  note: string | null;
  supplier: { id: string; name: string } | null;
  settlements: TitleSettlement[];
}

/** Saldo em aberto distribuído por faixa de vencimento. */
export interface Aging {
  vencido: number;
  ate7: number;
  ate30: number;
  acima30: number;
}

export interface FinanceOverview {
  receivables: {
    totalOpen: number;
    titles: number;
    customers: number;
    aging: Aging;
  };
  payables: {
    totalOpen: number;
    titles: number;
    aging: Aging;
    byCategory: Array<{ category: string; amount: number }>;
  };
}

export interface CreditStatus {
  customerId: string;
  customerName: string;
  limit: number;
  used: number;
  available: number;
  overdue: number;
  overdueCount: number;
}

export interface CashflowReport {
  period: { from: string; to: string };
  resultado: {
    receitaBruta: number;
    devolucoes: number;
    receitaLiquida: number;
    cmv: number;
    cmvEstimado: boolean;
    itensSemCusto: number;
    margemBruta: number;
    margemPercent: number;
    despesas: number;
    resultado: number;
    vendas: number;
    devolucoesCount: number;
  };
  caixa: {
    entradas: number;
    entradasVenda: number;
    recebimentos: number;
    saidas: number;
    despesas: number;
    devolucoes: number;
    saldo: number;
    byMethod: Array<{ method: PaymentMethod; amount: number }>;
    daily: Array<{ date: string; in: number; out: number }>;
  };
  despesasPorCategoria: Array<{ category: string; amount: number }>;
  projecao: {
    aReceber: Aging & { total: number };
    aPagar: Aging & { total: number };
    saldoProjetado: number;
  };
}

export interface TitleFilter {
  status?: TitleStatus;
  overdue?: boolean;
  search?: string;
  customerId?: string;
  supplierId?: string;
}

function titleQuery(filter: TitleFilter = {}) {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.overdue) params.set('overdue', 'true');
  if (filter.search) params.set('search', filter.search);
  if (filter.customerId) params.set('customerId', filter.customerId);
  if (filter.supplierId) params.set('supplierId', filter.supplierId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Retrato gravado do fechamento de um dia. */
export interface DailyClosing {
  id: string;
  date: string;
  status: 'FECHADO' | 'REABERTO';
  closedAt: string;
  closedBy: { id: string; name: string } | null;
  snapshot: DayPreview;
  totalSales: number;
  totalCashIn: number;
  cashDifference: number;
  sessionCount: number;
  notes: string | null;
  /** Quantas vezes o dia foi fechado — mais de 1 significa que foi reaberto. */
  version: number;
  reopenedAt: string | null;
  reopenedBy: { id: string; name: string } | null;
  reopenReason: string | null;
}

/** Os números do dia calculados agora (antes ou depois do fechamento). */
export interface DayPreview {
  date: string;
  generatedAt: string;
  totals: CashConsolidated['totals'];
  byPaymentMethod: CashConsolidated['byPaymentMethod'];
  unsettledPayments: CashConsolidated['unsettledPayments'];
  byTerminal: ConsolidatedGroup[];
  byOperator: ConsolidatedGroup[];
  sessions: ConsolidatedSession[];
  divergences: ConsolidatedSession[];
  openSessions: Array<{
    id: string;
    terminal: string | null;
    operator: string;
    openedAt: string;
  }>;
  movimento: {
    devolucoes: number;
    devolucoesCount: number;
    devolucoesEmDinheiro: number;
    recebimentos: number;
    recebimentosCount: number;
    despesas: number;
    despesasCount: number;
    liquido: number;
  };
}

export interface DayStatus {
  date: string;
  closing: DailyClosing | null;
  preview: DayPreview;
  locked: boolean;
  blockers: DayPreview['openSessions'];
  /**
   * O recorte por operador e as divergências só vêm para quem tem
   * `cash.consolidate`; sem ela, `byOperator`, `sessions` e `divergences`
   * chegam vazios (o servidor é quem decide, não a tela).
   */
  canSeeOperators: boolean;
}

export const financeApi = {
  overview: () => ApiClient.get<FinanceOverview>('/finance/overview'),
  cashflow: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return ApiClient.get<CashflowReport>(`/finance/cashflow${qs ? `?${qs}` : ''}`);
  },

  receivables: (filter?: TitleFilter) =>
    ApiClient.get<Receivable[]>(`/finance/receivables${titleQuery(filter)}`),
  creditStatus: (customerId: string) =>
    ApiClient.get<CreditStatus>(`/finance/receivables/credit/${customerId}`),
  setCreditLimit: (customerId: string, creditLimit: number) =>
    ApiClient.patch<CreditStatus>(`/finance/receivables/credit/${customerId}`, {
      creditLimit,
    }),
  createReceivable: (data: {
    customerId: string;
    description: string;
    amount: number;
    dueDate: string;
    installments?: number;
    note?: string;
  }) => ApiClient.post<Receivable[]>('/finance/receivables', data),
  settleReceivable: (
    id: string,
    data: { amount: number; method: PaymentMethod; note?: string },
  ) => ApiClient.post<Receivable>(`/finance/receivables/${id}/settle`, data),
  cancelReceivable: (id: string, reason: string) =>
    ApiClient.post<Receivable>(`/finance/receivables/${id}/cancel`, { reason }),

  payables: (filter?: TitleFilter) =>
    ApiClient.get<Payable[]>(`/finance/payables${titleQuery(filter)}`),
  payableCategories: () => ApiClient.get<string[]>('/finance/payables/categories'),
  createPayable: (data: {
    supplierId?: string;
    description: string;
    category?: string;
    amount: number;
    dueDate: string;
    recurrence?: PayableRecurrence;
    note?: string;
  }) => ApiClient.post<Payable>('/finance/payables', data),
  settlePayable: (
    id: string,
    data: { amount: number; method: PaymentMethod; note?: string },
  ) => ApiClient.post<Payable>(`/finance/payables/${id}/settle`, data),
  cancelPayable: (id: string, reason: string) =>
    ApiClient.post<Payable>(`/finance/payables/${id}/cancel`, { reason }),

  suppliers: (search?: string) =>
    ApiClient.get<Supplier[]>(
      `/finance/suppliers${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    ),
  createSupplier: (data: Partial<Supplier>) =>
    ApiClient.post<Supplier>('/finance/suppliers', data),
  updateSupplier: (id: string, data: Partial<Supplier>) =>
    ApiClient.patch<Supplier>(`/finance/suppliers/${id}`, data),

  dayStatus: (date?: string) =>
    ApiClient.get<DayStatus>(
      `/finance/daily-closing${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    ),
  dayHistory: () => ApiClient.get<DailyClosing[]>('/finance/daily-closing/history'),
  closeDay: (data: { date?: string; countedCash?: number; notes?: string }) =>
    ApiClient.post<DailyClosing>('/finance/daily-closing', data),
  reopenDay: (date: string, reason: string) =>
    ApiClient.post<DailyClosing>(
      `/finance/daily-closing/${encodeURIComponent(date)}/reopen`,
      { reason },
    ),
};
