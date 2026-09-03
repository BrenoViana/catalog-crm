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
export const customersApi = {
  list: (search?: string) =>
    ApiClient.get<Customer[]>(`/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
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
  fiscalDocument?: { status: string; model: number; number: number } | null;
  _count?: { items: number };
}
export interface CreateSaleInput {
  items: Array<{ productId: string; quantity: number; unitPrice?: number; discount?: number }>;
  payments: Array<{ method: PaymentMethod; amount: number; installments?: number }>;
  customerId?: string;
  discount?: number;
  note?: string;
}
export const salesApi = {
  list: (status?: string) =>
    ApiClient.get<Sale[]>(`/sales${status ? `?status=${status}` : ''}`),
  get: (id: string) => ApiClient.get<Sale>(`/sales/${id}`),
  create: (data: CreateSaleInput) => ApiClient.post<Sale>('/sales', data),
  cancel: (id: string, reason: string) => ApiClient.post<Sale>(`/sales/${id}/cancel`, { reason }),
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
export const cashApi = {
  current: () => ApiClient.get<CashSession | null>('/cash/current'),
  history: () => ApiClient.get<CashSession[]>('/cash/history'),
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
}
export const storeSettingsApi = {
  get: () => ApiClient.get<StoreSettings | null>('/store-settings'),
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
