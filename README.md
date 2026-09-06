# Catalog CRM

Catálogo de produtos e **PDV de balcão para varejo B2C**. Backend NestJS +
frontend React, com controle de estoque, caixa por turno, camada fiscal
(NFC-e) e licenciamento por módulos.

> O nome do repositório é herança da primeira versão, que era um CRM B2B de
> pipeline. O produto atual é varejo de balcão: as entidades de vendedor,
> oportunidade e funil foram substituídas por produto, estoque, venda, caixa e
> cliente B2C leve.

## Arquitetura

```
catalog-crm/
├── backend/     # NestJS 12 + Prisma 7 + PostgreSQL
├── frontend/    # React 19 + TypeScript + Vite
└── EXECUCAO.md  # como rodar os três serviços localmente
```

## Tecnologias

**Backend** — NestJS 12, Prisma 7 (adapter `pg`), PostgreSQL, JWT com Passport,
`class-validator`, Helmet, TypeScript.

**Frontend** — React 19, React Router 7, TanStack Query 5, Zustand 5, Vite 8,
TypeScript.

## Módulos

### Backend

| Módulo | O que faz |
| --- | --- |
| `auth` | Login com JWT e rate limit por IP |
| `access` | Permissões granulares no banco, papéis e vale de supervisor |
| `products` / `categories` | Catálogo, busca por trigram (tolera acento e erro de digitação) |
| `inventory` | Estoque, movimentos e ajustes com trilha |
| `sales` | Venda de balcão, desconto com teto por papel, devolução e troca parcial |
| `payments` | Gateway com provedores de dinheiro e eletrônico (Pix/cartão) |
| `cash` | Turno de caixa, sangria/suprimento, leitura X e fechamento Z |
| `finance` | Contas a pagar/receber, crediário, fluxo de caixa e fechamento do dia |
| `loyalty` | Crédito e cashback do cliente |
| `promotions` | Motor de campanhas aplicado por item da venda |
| `fiscal` | NFC-e com máquina de estados do documento fiscal |
| `reports` / `dashboard` / `ops` | Relatórios em CSV, KPIs e alertas operacionais |
| `license` | Licenciamento por módulos, chave Ed25519 verificada offline |
| `settings` / `store-settings` | Configurações do sistema e da loja |

### Frontend

PDV, produtos, categorias, estoque, vendas, caixa, financeiro, promoções,
relatórios, clientes, dashboard e configurações.

## Papéis e permissões

Três papéis — `ADMIN`, `GERENTE` e `OPERADOR` — sobre um catálogo de 33
permissões granulares persistidas no banco. Operações acima do teto do operador
(desconto elevado, cancelamento de venda, devolução) podem ser liberadas caso a
caso por **vale de supervisor**: o gerente autoriza no próprio balcão, o vale
vale uma vez, e quem fez e quem liberou ficam na trilha de auditoria.

## Licenciamento por módulos

O **núcleo** (catálogo, venda, caixa) está sempre ativo — licença vencida nunca
impede a loja de vender nem de abrir o caixa. Os módulos `Fiscal`,
`Promoções & fidelidade`, `Financeiro`, `Relatórios` e `Escala` são liberados
por uma chave Ed25519 assinada pelo fornecedor e **verificada offline**: a
instalação só verifica, a chave privada nunca entra no repositório nem no
`.env` do cliente.

## Executando localmente

O guia completo — banco, backend, frontend, migrations, seed, health check e
problemas comuns — está em **[EXECUCAO.md](EXECUCAO.md)**. Em resumo:

```bash
npm install                          # na raiz (workspaces)
cd backend && npx prisma dev -d      # Postgres embarcado, sem Docker
npx prisma migrate deploy && npm run seed
cd .. && npm run dev -w backend      # http://localhost:3000/api
npm run dev -w frontend              # http://localhost:5173
```

Requisitos: Node na versão do `.nvmrc` (hoje 20, a mesma do CI) e npm 11+.

> O seed **apaga** vendas, caixa, produtos e usuários antes de recriar a base de
> exemplo. Por isso só roda com `NODE_ENV=development`.

Usuários de desenvolvimento: `admin/admin`, `gerente/gerente`,
`operador/operador`.

## Segurança

O projeto lida com dinheiro, dados fiscais e dados pessoais sob LGPD. Algumas
travas que valem conhecer antes de fazer deploy:

- **`NODE_ENV` ausente vale como produção** (falha fechada). Sem ele, o backend
  exige `JWT_SECRET` forte e recusa o gateway de pagamento simulado.
- **O provedor de pagamento simulado confirma qualquer valor sem cobrar nada.**
  Ele só sobe em desenvolvimento ou com `ALLOW_FAKE_PAYMENT_GATEWAY`
  explicitamente ligado. Numa loja real, é entregar mercadoria de graça.
- **Material criptográfico não entra no repositório**: o `.gitignore` fecha
  `*.pem`, `*.key`, `*.p12`, `*.pfx` e `*.der`, e a ferramenta de emissão de
  licença recusa gravar a chave privada dentro de um diretório versionado.
- Toda operação financeira — fechamento do dia, baixa de título, ajuste de
  fidelidade, sangria, cancelamento — vai para o `AuditLog`, com quem fez e
  quem liberou.

Mudanças passam por uma revisão de segurança antes do merge, e os achados em
aberto ficam registrados em `.claude/agents/baseline.md`.

## Testes e CI

- **E2E de balcão**: `npm run test:e2e -w backend` sobe a aplicação NestJS real
  numa porta efêmera e exercita abertura de caixa, venda, pagamento, promoção,
  vale de supervisor, devolução, cancelamento e fechamento Z — 88 verificações.
  Exige banco no ar e seed aplicado.
- **CI** (GitHub Actions): build e typecheck de backend e frontend a cada push
  e PR. A `main` exige histórico linear e o check verde para aceitar merge.

---

**Status**: em desenvolvimento ativo · **Licença**: MIT
