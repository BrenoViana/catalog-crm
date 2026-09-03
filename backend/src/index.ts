import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { createId, buildDashboardSummary, customers, licenseConfig, opportunities, sales, sellers, users } from './db/mockDb.js';
import { signToken } from './utils/auth.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'catalog-crm-backend' });
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = users.find((item) => item.username === username && item.password === password);

  if (!user) {
    return res.status(401).json({ message: 'Credenciais inválidas.' });
  }

  const token = signToken({
    sub: user.id,
    username: user.username,
    role: user.role,
  });

  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    },
  });
});

app.get('/dashboard/summary', requireAuth, (_req, res) => {
  res.json(buildDashboardSummary());
});

app.get('/customers', requireAuth, (_req, res) => {
  res.json(customers);
});

app.post('/customers', requireAuth, (req, res) => {
  const payload = req.body ?? {};
  const customer = {
    id: createId(),
    name: payload.name ?? '',
    company: payload.company ?? '',
    email: payload.email ?? '',
    phone: payload.phone ?? '',
    segment: payload.segment ?? '',
    status: payload.status ?? 'lead',
    createdAt: new Date().toISOString(),
  };

  customers.push(customer);
  return res.status(201).json(customer);
});

app.get('/sellers', requireAuth, (_req, res) => {
  res.json(sellers);
});

app.get('/opportunities', requireAuth, (_req, res) => {
  res.json(opportunities);
});

app.post('/opportunities', requireAuth, (req, res) => {
  const payload = req.body ?? {};
  const opportunity = {
    id: createId(),
    customerId: payload.customerId,
    sellerId: payload.sellerId,
    title: payload.title ?? 'Nova oportunidade',
    stage: payload.stage ?? 'prospecting',
    amount: Number(payload.amount ?? 0),
    expectedCloseDate: payload.expectedCloseDate ?? new Date().toISOString(),
    notes: payload.notes ?? '',
    createdAt: new Date().toISOString(),
  };

  opportunities.push(opportunity);
  return res.status(201).json(opportunity);
});

app.get('/sales', requireAuth, (_req, res) => {
  res.json(sales);
});

app.get('/settings/license', requireAuth, (_req, res) => {
  res.json(licenseConfig);
});

app.put('/settings/license', requireAuth, (req, res) => {
  const body = req.body ?? {};
  const key = String(body.key ?? '').trim();
  const customer = String(body.customer ?? 'Cliente').trim();

  if (!key) {
    return res.status(400).json({ message: 'A chave de ativação não pode ficar vazia.' });
  }

  licenseConfig.key = key;
  licenseConfig.customer = customer;
  licenseConfig.active = true;
  licenseConfig.updatedAt = new Date().toISOString();

  return res.json(licenseConfig);
});

app.listen(config.port, () => {
  console.log(`Catalog CRM backend running on http://localhost:${config.port}`);
});
