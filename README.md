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
| `products` / `categories` | Catálogo, busca por trigram (tolera acento e erro de digitação), foto do produto (recorte no navegador, bytes no banco) |
| `inventory` | Estoque, movimentos e ajustes com trilha |
| `sales` | Venda de balcão, desconto com teto por papel, devolução e troca parcial |
| `payments` | Gateway com provedores de dinheiro e eletrônico (Pix/cartão) |
| `cash` | Turno de caixa, sangria/suprimento, leitura X e fechamento Z |
| `finance` | Contas a pagar/receber, crediário, contas financeiras, plano de contas e centros de custo, transferências, dashboard financeiro, fluxo de caixa e fechamento do dia |
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
impede a loja de vender à vista nem de abrir o caixa. A venda **a prazo** é a
exceção: ela depende do módulo `Financeiro` e é recusada sem ele.

Os módulos `Fiscal`, `Promoções & fidelidade`, `Financeiro` e `Relatórios` são
liberados por uma chave Ed25519 assinada pelo fornecedor e **verificada
offline**: a instalação só verifica, a chave privada nunca entra no repositório
nem no `.env` do cliente. O módulo `Escala` (multi-caixa consolidado, multi-loja
e operação offline) consta do catálogo mas ainda **não tem funcionalidade
associada** — está no roadmap, não em produção.

## Executando localmente

O guia completo — banco, backend, frontend, migrations, seed, health check e
problemas comuns — está em **[EXECUCAO.md](EXECUCAO.md)**. Em resumo:

```bash
npm install                     # na raiz (workspaces)
cd backend
cp .env.example .env            # confira: DATABASE_URL precisa apontar para localhost
npx prisma dev -d               # Postgres embarcado, sem Docker
npx prisma migrate dev          # 'migrate deploy' é o comando de produção
npm run seed                    # DESTRUTIVO — veja o aviso abaixo
cd .. && npm run dev -w backend # http://localhost:3000/api
npm run dev -w frontend         # http://localhost:5173
```

Requisitos: Node na versão do `.nvmrc` (hoje 20, a mesma do CI) e npm 11+.

> **O seed apaga dados.** Ele remove vendas, caixa, auditoria, produtos e
> usuários antes de recriar a base de exemplo. Só roda com
> `NODE_ENV=development` — e é o `backend/.env` que decide isso, então confirme
> para onde o `DATABASE_URL` aponta **antes** de rodar.

Usuários criados **apenas** pelo seed de desenvolvimento. Nenhuma instalação
real deve tê-los — crie o administrador pela API e nunca rode o seed contra o
banco de uma loja:

| Usuário | Senha | Papel |
| --- | --- | --- |
| `admin` | `admin` | ADMIN |
| `gerente` | `gerente` | GERENTE |
| `operador` | `operador` | OPERADOR |

## Segurança

O projeto lida com dinheiro, dados fiscais e dados pessoais sob LGPD. Algumas
travas que valem conhecer antes de fazer deploy:

- **`NODE_ENV` ausente vale como produção** (falha fechada). Sem ele, o backend
  exige `JWT_SECRET` forte e recusa o gateway de pagamento simulado. Atenção ao
  mecanismo: o `main.ts` carrega `backend/.env` **antes** dessa checagem, então
  um `.env` de desenvolvimento embarcado no deploy desliga as três travas de uma
  vez — segredo de JWT de fallback, gateway simulado ativo e todos os módulos
  liberados. Em produção, gere um `.env` próprio com
  `NODE_ENV=production`, `JWT_SECRET` aleatório de 32+ caracteres,
  `ALLOW_FAKE_PAYMENT_GATEWAY=false` e `CORS_ORIGIN` sem `localhost`.
- **O provedor de pagamento simulado confirma qualquer valor sem cobrar nada.**
  Ele só sobe em desenvolvimento ou com `ALLOW_FAKE_PAYMENT_GATEWAY`
  explicitamente ligado. Numa loja real, é entregar mercadoria de graça.
- **Material criptográfico não entra no repositório**: o `.gitignore` fecha
  `*.pem`, `*.key`, `*.p12`, `*.pfx` e `*.der`, e a ferramenta de emissão de
  licença recusa gravar a chave privada dentro de um diretório versionado.
- Toda operação financeira — fechamento do dia, baixa de título, ajuste de
  fidelidade, sangria, cancelamento — vai para o `AuditLog`, com quem fez e
  quem liberou.
- **A foto do produto é servida por rota pública** (`GET /api/product-images/:token`):
  `<img src>` não manda header `Authorization`, e o token do app vive em
  `localStorage`, sem cookie de sessão. O que protege é o endereço — 16 bytes
  aleatórios, sem relação com o id do produto, renovados a cada upload e nunca
  listados sem autenticação. Guardar ali só foto de vitrine, nunca imagem com
  dado pessoal (documento, ficha de cliente). O upload continua exigindo
  `products.manage`, aceita apenas PNG/JPEG/WebP com os bytes mágicos conferidos
  no servidor (SVG é recusado) e tem teto de ~500 KB por imagem.

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
