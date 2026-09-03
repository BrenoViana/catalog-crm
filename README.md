# Catalog CRM

Sistema executivo de CRM integrado com catalogação de produtos e gerenciamento de vendas. Arquitetura moderna com separação completa entre frontend e backend.

## 🏗️ Arquitetura

```
catalog-crm/
├── backend/          # NestJS + Prisma + PostgreSQL
├── frontend/         # React + TypeScript + Vite
└── README.md
```

## 🚀 Tecnologias

### Backend
- **NestJS**: Framework modular com injeção de dependência
- **Prisma**: ORM tipo-seguro com migrations automáticas
- **PostgreSQL**: Banco de dados relacional em produção
- **JWT**: Autenticação stateless com tokens
- **TypeScript**: Tipagem estática e segurança em tempo de compilação

### Frontend
- **React 18.3**: UI moderna e responsiva
- **React Router**: Roteamento de páginas
- **React Query**: Gerenciamento de data fetching e estado do servidor
- **Zustand**: Estado global leve e eficiente
- **TypeScript**: Tipagem estática na camada de apresentação
- **Vite**: Build rápido e desenvolvimento ágil

## 📋 Módulos Principais

### Backend (NestJS)
- **Auth**: Autenticação com JWT e validação de credenciais
- **Users**: Gerenciamento de usuários e perfis
- **Customers**: Cadastro e gestão de clientes
- **Sellers**: Perfil de vendedores e metas
- **Opportunities**: Pipeline de vendas e oportunidades
- **Sales**: Registro de vendas e fluxo de caixa
- **Dashboard**: Métricas executivas e KPIs
- **License**: Validação e gerenciamento de licenças

### Frontend (React)
- **LoginPage**: Autenticação de usuário
- **DashboardPage**: Resumo executivo com KPIs e gráficos
- **CustomersPage**: Gestão de clientes
- **SellersPage**: Perfil e metas de vendedores
- **OpportunitiesPage**: Pipeline de oportunidades
- **SalesPage**: Registro de vendas
- **SettingsPage**: Configurações do sistema e licenças

## 🛠️ Desenvolvimento

### Requisitos
- Node.js 26.3.0+
- npm 11.16.0+
- PostgreSQL 14+

### Instalação Backend
```bash
cd backend
npm install
npx prisma migrate dev
npm run start:dev
```

### Instalação Frontend
```bash
cd frontend
npm install
npm run dev
```

### Build para Produção
```bash
# Backend
cd backend && npm run build && npm run start:prod

# Frontend
cd frontend && npm run build
```

## 🔐 Autenticação

O sistema utiliza autenticação baseada em JWT:

1. Login com usuário e senha
2. Backend valida credenciais
3. Emite token JWT válido por 24h
4. Frontend armazena token em localStorage
5. Cada requisição inclui token no header `Authorization: Bearer <token>`

## 📊 Dashboard Executivo

- KPIs de receita, meta mensal, pipeline e taxa de conversão
- Gráficos de vendas por período
- Ranking de top vendedores
- Exportação de relatórios em imagem e PDF
- Dark premium theme com animações suaves

## 🎯 Próximos Passos

- [ ] Integração de banco de dados PostgreSQL
- [ ] Seed inicial de dados (usuários, clientes, vendedores)
- [ ] Implementação de filtros avançados no dashboard
- [ ] Exportação de relatórios em PDF executivo
- [ ] Webhooks para integrações externas
- [ ] Testes E2E com Cypress

---

**Status**: Em desenvolvimento ativo | **Versão**: 1.0.0
