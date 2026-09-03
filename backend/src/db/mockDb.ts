import { v4 as uuidv4 } from 'uuid';
import type { Customer, DashboardSummary, LicenseConfig, Opportunity, Sale, Seller, User } from '../types.js';

export const users: User[] = [
  {
    id: 'user-1',
    username: 'admin',
    password: 'admin123',
    role: 'admin',
    name: 'Administrador',
  },
];

export const sellers: Seller[] = [
  {
    id: 'seller-1',
    name: 'Carlos Mendes',
    email: 'carlos@empresa.com',
    phone: '(11) 98888-1111',
    role: 'Account Executive',
    target: 120000,
    commissionRate: 8,
  },
  {
    id: 'seller-2',
    name: 'Fernanda Rocha',
    email: 'fernanda@empresa.com',
    phone: '(11) 98888-2222',
    role: 'Senior Seller',
    target: 150000,
    commissionRate: 10,
  },
];

export const customers: Customer[] = [
  {
    id: 'customer-1',
    name: 'Maria Silva',
    company: 'Alpha Soluções',
    email: 'maria@alphasolucoes.com',
    phone: '(11) 99999-0001',
    segment: 'Tecnologia',
    status: 'qualified',
    createdAt: '2026-08-01',
  },
  {
    id: 'customer-2',
    name: 'João Pereira',
    company: 'North Invest',
    email: 'joao@northinvest.com',
    phone: '(21) 98888-0002',
    segment: 'Financeiro',
    status: 'proposal',
    createdAt: '2026-08-12',
  },
  {
    id: 'customer-3',
    name: 'Ana Costa',
    company: 'Nova Vision',
    email: 'ana@novavision.com',
    phone: '(31) 97777-0003',
    segment: 'Marketing',
    status: 'lead',
    createdAt: '2026-08-19',
  },
  {
    id: 'customer-4',
    name: 'Paulo Nunes',
    company: 'Green Box',
    email: 'paulo@greenbox.com',
    phone: '(41) 96666-0004',
    segment: 'Logística',
    status: 'won',
    createdAt: '2026-07-19',
  },
];

export const opportunities: Opportunity[] = [
  {
    id: 'opp-1',
    customerId: 'customer-1',
    sellerId: 'seller-1',
    title: 'CRM + automação comercial',
    stage: 'qualification',
    amount: 24500,
    expectedCloseDate: '2026-09-20',
    notes: 'Cliente em fase de validação técnica.',
    createdAt: '2026-08-15',
  },
  {
    id: 'opp-2',
    customerId: 'customer-2',
    sellerId: 'seller-2',
    title: 'Consultoria de gestão financeira',
    stage: 'proposal',
    amount: 38000,
    expectedCloseDate: '2026-09-28',
    notes: 'Proposta enviada e aguardando retorno.',
    createdAt: '2026-08-20',
  },
  {
    id: 'opp-3',
    customerId: 'customer-4',
    sellerId: 'seller-1',
    title: 'Sistema de gestão e rastreio',
    stage: 'won',
    amount: 52000,
    expectedCloseDate: '2026-08-30',
    notes: 'Projeto aprovado e em implantação.',
    createdAt: '2026-07-10',
  },
];

export const sales: Sale[] = [
  {
    id: 'sale-1',
    opportunityId: 'opp-3',
    customerId: 'customer-4',
    sellerId: 'seller-1',
    amount: 52000,
    status: 'paid',
    createdAt: '2026-08-28',
  },
  {
    id: 'sale-2',
    opportunityId: 'opp-1',
    customerId: 'customer-1',
    sellerId: 'seller-1',
    amount: 24500,
    status: 'pending',
    createdAt: '2026-08-21',
  },
];

export const licenseConfig: LicenseConfig = {
  key: 'ACTIVATE-2026',
  customer: 'Demo Company',
  active: true,
  updatedAt: new Date().toISOString(),
};

export const createId = () => uuidv4();

export const buildDashboardSummary = (): DashboardSummary => {
  const revenueBySeller = sellers.map((seller) => {
    const summary = sales
      .filter((sale) => sale.sellerId === seller.id)
      .reduce((acc, sale) => acc + sale.amount, 0);

    return { seller: seller.name, value: summary };
  });

  const pipelineByStage = {
    prospecting: opportunities.filter((opp) => opp.stage === 'prospecting').length,
    qualification: opportunities.filter((opp) => opp.stage === 'qualification').length,
    proposal: opportunities.filter((opp) => opp.stage === 'proposal').length,
    negotiation: opportunities.filter((opp) => opp.stage === 'negotiation').length,
    won: opportunities.filter((opp) => opp.stage === 'won').length,
    lost: opportunities.filter((opp) => opp.stage === 'lost').length,
  };

  const totalRevenue = sales.reduce((acc, item) => acc + item.amount, 0);
  const wonRevenue = opportunities
    .filter((opp) => opp.stage === 'won')
    .reduce((acc, opp) => acc + opp.amount, 0);

  return {
    totalCustomers: customers.length,
    totalOpportunities: opportunities.length,
    totalRevenue,
    wonRevenue,
    openPipeline: opportunities.filter((opp) => opp.stage !== 'won' && opp.stage !== 'lost').length,
    conversionRate: opportunities.length ? (opportunities.filter((opp) => opp.stage === 'won').length / opportunities.length) * 100 : 0,
    pipelineByStage,
    revenueBySeller,
  };
};
