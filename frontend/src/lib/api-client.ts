import { ApiClient } from './api';

// Auth
export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    username: string;
    name: string;
    role: string;
  };
}

export const authApi = {
  login: (data: LoginRequest) => ApiClient.post<AuthResponse>('/auth/login', data),
};

// Dashboard
export interface DashboardSummary {
  totalRevenue: number;
  monthlyTarget: number;
  pipeline: number;
  conversionRate: number;
  salesByMonth: Array<{ month: string; value: number }>;
  topSellers: Array<{ name: string; value: number }>;
}

export const dashboardApi = {
  getSummary: () => ApiClient.get<DashboardSummary>('/dashboard/summary'),
};

// Customers
export interface Customer {
  id: string;
  name: string;
  company: string;
  email?: string;
  phone?: string;
  segment?: string;
  status: string;
  createdAt: string;
}

export const customersApi = {
  getAll: () => ApiClient.get<Customer[]>('/customers'),
  getById: (id: string) => ApiClient.get<Customer>(`/customers/${id}`),
  create: (data: Omit<Customer, 'id' | 'createdAt'>) =>
    ApiClient.post<Customer>('/customers', data),
  update: (id: string, data: Partial<Customer>) =>
    ApiClient.put<Customer>(`/customers/${id}`, data),
  delete: (id: string) => ApiClient.delete<{ message: string }>(`/customers/${id}`),
};

// Sellers
export interface Seller {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  salesTarget: number;
  commissionRate: number;
  createdAt: string;
}

export const sellersApi = {
  getAll: () => ApiClient.get<Seller[]>('/sellers'),
  getById: (id: string) => ApiClient.get<Seller>(`/sellers/${id}`),
  create: (data: Omit<Seller, 'id' | 'createdAt'>) =>
    ApiClient.post<Seller>('/sellers', data),
  update: (id: string, data: Partial<Seller>) =>
    ApiClient.put<Seller>(`/sellers/${id}`, data),
  delete: (id: string) => ApiClient.delete<{ message: string }>(`/sellers/${id}`),
};

// Opportunities
export interface Opportunity {
  id: string;
  title: string;
  customerId: string;
  sellerId: string;
  stage: string;
  amount: number;
  expectedCloseDate?: string;
  notes?: string;
  createdAt: string;
}

export const opportunitiesApi = {
  getAll: () => ApiClient.get<Opportunity[]>('/opportunities'),
  getById: (id: string) => ApiClient.get<Opportunity>(`/opportunities/${id}`),
  create: (data: Omit<Opportunity, 'id' | 'createdAt'>) =>
    ApiClient.post<Opportunity>('/opportunities', data),
  update: (id: string, data: Partial<Opportunity>) =>
    ApiClient.put<Opportunity>(`/opportunities/${id}`, data),
  delete: (id: string) => ApiClient.delete<{ message: string }>(`/opportunities/${id}`),
};

// Sales
export interface Sale {
  id: string;
  opportunityId: string;
  amount: number;
  status: string;
  createdAt: string;
}

export const salesApi = {
  getAll: () => ApiClient.get<Sale[]>('/sales'),
  getById: (id: string) => ApiClient.get<Sale>(`/sales/${id}`),
  create: (data: Omit<Sale, 'id'>) => ApiClient.post<Sale>('/sales', data),
  update: (id: string, data: Partial<Sale>) => ApiClient.put<Sale>(`/sales/${id}`, data),
  delete: (id: string) => ApiClient.delete<{ message: string }>(`/sales/${id}`),
};

// License
export interface LicenseInfo {
  status: string;
  key: string;
  expiresAt: string;
}

export const licenseApi = {
  getInfo: () => ApiClient.get<LicenseInfo>('/license/info'),
  update: (key: string) => ApiClient.post<LicenseInfo>('/license/update', { key }),
};
