# Quick Start - Catalog CRM

Guia rápido para iniciar o sistema completo em desenvolvimento.

## 🚀 Começando Rápido (5 minutos)

### Pré-requisitos
- Node.js 26.3.0+
- PostgreSQL 14+ (ou Docker)
- npm 11.16.0+

### 1️⃣ Iniciar banco de dados

**Opção A: Com Docker**
```bash
docker-compose up -d
```
Isso inicia:
- PostgreSQL em `localhost:5432`
- PgAdmin em `http://localhost:5050`

**Opção B: PostgreSQL local**
```bash
# Criar banco de dados
createdb catalog_crm
```

### 2️⃣ Instalar dependências

```bash
# Raiz do projeto
npm install

# Ou individualmente
cd backend && npm install
cd ../frontend && npm install
```

### 3️⃣ Configurar banco de dados

```bash
cd backend

# Executar migrations
npm run prisma:migrate

# Populate dados de teste
npm run seed
```

### 4️⃣ Iniciar a aplicação

**Opção A: Tudo junto (recomendado)**
```bash
# Na raiz do projeto
npm run dev
```

**Opção B: Terminais separados**
```bash
# Terminal 1 - Backend
npm run backend:dev
# Será executado em http://localhost:3000/api

# Terminal 2 - Frontend
npm run frontend:dev
# Será executado em http://localhost:5173
```

### 5️⃣ Acessar a aplicação

Abra o navegador e acesse:
```
http://localhost:5173
```

**Credenciais padrão:**
- **Usuário**: admin
- **Senha**: admin

---

## 🔗 URLs Importantes

| Serviço | URL | Descrição |
|---------|-----|-----------|
| Frontend | http://localhost:5173 | Interface do CRM |
| Backend API | http://localhost:3000/api | API REST |
| PostgreSQL | localhost:5432 | Banco de dados |
| PgAdmin | http://localhost:5050 | Gerenciador de DB |
| Prisma Studio | http://localhost:5555 | Visualizador de dados |

---

## 📊 Visualizar dados com Prisma Studio

```bash
cd backend
npm run prisma:studio
```

---

## 🛠️ Comandos Úteis

### Backend
```bash
npm run backend:dev      # Desenvolvimento
npm run backend:build    # Build para produção
npm run build            # Compilar TypeScript
npm run start            # Rodar em produção
npm run prisma:migrate   # Executar migrations
npm run prisma:studio    # Abrir Prisma Studio
npm run seed             # Populate dados de teste
```

### Frontend
```bash
npm run frontend:dev     # Desenvolvimento
npm run frontend:build   # Build para produção
npm run frontend:preview # Preview do build
```

---

## 🧪 Fluxos Testados

### Login
1. Acesse http://localhost:5173/login
2. Use `admin` / `admin`
3. Será redirecionado para o dashboard

### Dashboard
- Visualiza KPIs e gráficos
- Mostra dados de top vendedores
- Exibe pipeline de vendas

### Clientes
- Lista todos os clientes cadastrados
- Segmentação por tipo
- Status da relação

### Vendedores
- Perfil com metas de vendas
- Taxa de comissão
- Histórico de vendas

### Oportunidades
- Pipeline de vendas
- Etapas do funil
- Valor da oportunidade

### Vendas
- Registro de transações
- Status do pagamento
- Data de fechamento

---

## ⚠️ Troubleshooting

### Porta 3000 em uso
```bash
PORT=3001 npm run backend:dev
# Lembrar de alterar VITE_API_URL no frontend/.env.local
```

### Banco de dados não conecta
```bash
# Verificar .env
cat .env

# Conectar manualmente ao PostgreSQL
psql -U postgres -d catalog_crm

# Se não existir, criar:
createdb -U postgres catalog_crm
```

### Erro de migração
```bash
# Resetar banco (CUIDADO: deleta tudo)
npm run prisma:migrate reset

# Ou executar migrations do zero
rm prisma/migrations
npm run prisma:migrate dev --name init
```

### Frontend não conecta ao backend
```bash
# Verificar se backend está rodando
curl http://localhost:3000/api/auth/login

# Verificar VITE_API_URL no frontend/.env.local
cat frontend/.env.local
```

---

## 📝 Próximos Passos

- [ ] Implementar formulários de cadastro
- [ ] Adicionar filtros avançados
- [ ] Exportação de relatórios em PDF
- [ ] Testes E2E com Cypress
- [ ] Deploy em staging/produção

---

**Desenvolvido com ❤️ usando NestJS + React + Prisma**
