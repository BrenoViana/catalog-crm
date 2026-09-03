export type Role = 'admin' | 'seller' | 'manager';

export interface User {
  id: string;
  username: string;
  password: string;
  role: Role;
  name: string;
}

export interface Customer {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  segment: string;
  status: 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  createdAt: string;
}

export interface Seller {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  target: number;
  commissionRate: number;
}

export interface Opportunity {
  id: string;
  customerId: string;
  sellerId: string;
  title: string;
  stage: 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'won' | 'lost';
  amount: number;
  expectedCloseDate: string;
  notes: string;
  createdAt: string;
}

export interface Sale {
  id: string;
  opportunityId: string;
  customerId: string;
  sellerId: string;
  amount: number;
  status: 'paid' | 'pending' | 'cancelled';
  createdAt: string;
}

export interface LicenseConfig {
  key: string;
  customer: string;
  active: boolean;
  updatedAt: string;
}

export interface DashboardSummary {
  totalCustomers: number;
  totalOpportunities: number;
  totalRevenue: number;
  wonRevenue: number;
  openPipeline: number;
  conversionRate: number;
  pipelineByStage: Record<string, number>;
  revenueBySeller: Array<{ seller: string; value: number }>;
}
