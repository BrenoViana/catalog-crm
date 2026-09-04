const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

export class ApiClient {
  private static getAuthToken(): string | null {
    return localStorage.getItem('crm-token');
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
        localStorage.removeItem('crm-token');
        localStorage.removeItem('crm-user');
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
  static post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
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
}

// ---------------------------------------------------------------- Auth
export interface AuthResponse {
  access_token: string;
  user: { id: string; username: string; name: string; role: string };
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
export type PaymentMethod = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | 'CREDIARIO' | 'OUTRO';
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
  createdAt: string;
  completedAt: string | null;
  customer?: Customer | null;
  operator?: { id: string; name: string };
  items?: SaleItem[];
  payments?: Array<{ id: string; method: PaymentMethod; amount: number; installments: number | null }>;
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

export const salesApi = {
  list: (status?: string) =>
    ApiClient.get<Sale[]>(`/sales${status ? `?status=${status}` : ''}`),
  get: (id: string) => ApiClient.get<Sale>(`/sales/${id}`),
  create: (data: CreateSaleInput) => ApiClient.post<Sale>('/sales', data),
  cancel: (id: string, reason: string) => ApiClient.post<Sale>(`/sales/${id}/cancel`, { reason }),
  returns: (id: string) => ApiClient.get<SaleReturn[]>(`/sales/${id}/returns`),
  createReturn: (id: string, data: CreateReturnInput) =>
    ApiClient.post<SaleReturn>(`/sales/${id}/returns`, data),
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
export interface CashSession {
  id: string;
  status: 'ABERTA' | 'FECHADA';
  openingAmount: number;
  openedAt: string;
  closedAt: string | null;
  closingCountedAmount: number | null;
  closingExpectedAmount: number | null;
  difference: number | null;
  expectedAmount?: number;
  movements: Array<{ id: string; type: string; amount: number; reason: string | null; createdAt: string }>;
}
export interface CashReport {
  kind: 'X' | 'Z';
  generatedAt: string;
  session: {
    id: string;
    status: 'ABERTA' | 'FECHADA';
    openedAt: string;
    closedAt: string | null;
    openingAmount: number;
    notes: string | null;
  };
  operator: { id: string; name: string } | null;
  sales: { count: number; total: number; discountTotal: number; canceledCount: number };
  byPaymentMethod: Array<{ method: PaymentMethod; count: number; amount: number }>;
  cash: {
    opening: number;
    sales: number;
    suprimentos: number;
    sangrias: number;
    expected: number;
    counted: number | null;
    difference: number | null;
  };
}

export const cashApi = {
  current: () => ApiClient.get<CashSession | null>('/cash/current'),
  history: () => ApiClient.get<CashSession[]>('/cash/history'),
  report: () => ApiClient.get<CashReport>('/cash/report'),
  reportFor: (sessionId: string) => ApiClient.get<CashReport>(`/cash/report/${sessionId}`),
  open: (openingAmount: number, notes?: string) =>
    ApiClient.post<CashSession>('/cash/open', { openingAmount, notes }),
  movement: (type: 'SANGRIA' | 'SUPRIMENTO', amount: number, reason?: string) =>
    ApiClient.post<CashSession>('/cash/movement', { type, amount, reason }),
  close: (countedAmount: number, notes?: string) =>
    ApiClient.post<CashSession>('/cash/close', { countedAmount, notes }),
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
export const licenseApi = {
  get: () => ApiClient.get<LicenseInfo>('/settings/license'),
  update: (key: string, customer?: string) =>
    ApiClient.put<LicenseInfo>('/settings/license', { key, customer }),
};
