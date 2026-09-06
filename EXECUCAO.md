# Como executar o catalog-crm localmente

Guia operacional dos três processos que compõem o ambiente de desenvolvimento:
**banco**, **backend** e **frontend**. Cada um roda em seu próprio terminal e
todos ficam abertos enquanto você trabalha.

| Serviço  | Comando                          | Onde responde                  |
| -------- | -------------------------------- | ------------------------------ |
| Banco    | `npx prisma dev` (em `backend/`) | `localhost:51214` (TCP)        |
| Backend  | `npm run dev -w backend`         | http://localhost:3000/api      |
| Frontend | `npm run dev -w frontend`        | http://localhost:5173          |

## Pré-requisitos

- Node.js na versão do `.nvmrc` (hoje **20**, a mesma que o CI usa) e npm 11+.
  Máquinas de desenvolvimento aqui rodam Node 26 e funcionam, mas o CI valida
  só o `.nvmrc` — divergência de runtime não aparece no build.
- Dependências instaladas na raiz do repositório: `npm install`
- Arquivo `backend/.env` (copie de `backend/.env.example`) e
  `frontend/.env.local` (copie de `frontend/.env.example`)

O `backend/.env` precisa, no mínimo, de `NODE_ENV=development`, `JWT_SECRET`,
`DATABASE_URL`, `SHADOW_DATABASE_URL` e `ALLOW_FAKE_PAYMENT_GATEWAY`. Com
`NODE_ENV=development` o backend aceita um segredo JWT fraco, libera todos os
módulos licenciados e permite o provedor de pagamento simulado — nada disso
vale em produção.

> **`ALLOW_FAKE_PAYMENT_GATEWAY`.** O provedor eletrônico simulado (Pix/cartão)
> **confirma qualquer valor sem cobrar nada**. Em produção a variável é sempre
> `false`: ligá-la fora de desenvolvimento entrega mercadoria de graça.

## 1. Banco de dados

O ambiente local usa o Postgres embarcado do Prisma (`prisma dev`), sem Docker.

```bash
cd backend
npx prisma dev            # deixe rodando; -d roda em segundo plano
```

Confira o estado e as URLs de conexão a qualquer momento:

```bash
npx prisma dev ls
```

As portas são fixas por instância: **51214** é o banco e **51215** o shadow
database usado pelo Prisma Migrate. Elas já estão no `backend/.env.example`; se
o `ls` mostrar outras, atualize `DATABASE_URL` e `SHADOW_DATABASE_URL`.

Com o banco de pé, aplique o schema e (opcionalmente) popule dados de exemplo:

```bash
cd backend
npx prisma migrate dev    # aplica as migrations e gera o client
npm run seed              # opcional — ver aviso abaixo
```

> **O seed apaga dados.** Ele limpa vendas, pagamentos, movimentos de caixa,
> produtos, clientes e usuários antes de recriar a base de exemplo. Por isso só
> roda com `NODE_ENV=development`. Nunca aponte para um banco de loja real.

Usuários criados pelo seed (apenas desenvolvimento):

| Usuário    | Senha      | Papel    |
| ---------- | ---------- | -------- |
| `admin`    | `admin`    | ADMIN    |
| `gerente`  | `gerente`  | GERENTE  |
| `operador` | `operador` | OPERADOR |

### Alternativa: Postgres via Docker

Se preferir um Postgres tradicional, o `docker-compose.yml` da raiz sobe
Postgres em `localhost:5432` e PgAdmin em `http://localhost:5050`:

```bash
docker compose up -d
```

Nesse caso troque no `backend/.env`:

```
DATABASE_URL="postgres://postgres:postgres@localhost:5432/catalog_crm"
```

e remova `SHADOW_DATABASE_URL` (o Postgres tradicional cria o shadow sozinho).

## 2. Backend (NestJS)

```bash
npm run dev -w backend     # a partir da raiz do repositório
```

Equivale a `nest start --watch`: recompila a cada alteração. A API sobe em
http://localhost:3000/api — todas as rotas ficam sob o prefixo `/api`.

Para rodar a versão compilada em vez do watch:

```bash
npm run build -w backend
npm run start -w backend   # node dist/main.js
```

> Isto ainda é execução **local**, não produção. O `main.ts` carrega
> `backend/.env` incondicionalmente, então `NODE_ENV=development` continua
> valendo e as travas seguem desligadas: segredo de JWT de fallback, todos os
> módulos licenciados liberados e gateway de pagamento simulado ativo. Para um
> ambiente real **não copie o `.env` de desenvolvimento** — gere outro com
> `NODE_ENV=production`, `ALLOW_FAKE_PAYMENT_GATEWAY=false`, `CORS_ORIGIN` sem
> `localhost` e um `JWT_SECRET` aleatório:
>
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
> ```

## 3. Frontend (React + Vite)

```bash
npm run dev -w frontend    # a partir da raiz do repositório
```

Abre em http://localhost:5173, com hot reload. O endereço da API vem de
`VITE_API_URL` no `frontend/.env.local` e precisa incluir o `/api`:

```
VITE_API_URL=http://localhost:3000/api
```

Para servir o build de produção localmente:

```bash
npm run build -w frontend
npm run preview -w frontend   # http://localhost:4173
```

## Verificando se está tudo no ar

```bash
curl http://localhost:3000/api/health
```

A resposta diz explicitamente se o banco está conectado:

```json
{ "status": "ok", "db": true, "uptime": 42, "timestamp": "..." }
```

`"status": "degraded"` com `"db": false` significa que o backend está de pé mas
não alcança o banco — veja a seção seguinte.

## Problemas comuns

**`db: false` no health check, ou `P1001: Can't reach database server`.**
O `prisma dev` caiu ou ficou em estado inconsistente. É comum a porta 51214
continuar escutando mesmo assim, então o teste confiável é
`npx prisma migrate status` dentro de `backend/`. Para resolver, pare e suba a
instância de novo:

```bash
cd backend
npx prisma dev stop default
npx prisma dev
```

Como o backend abre o pool de conexões no boot, **reinicie o backend depois de
reiniciar o banco** — senão ele continua com conexões mortas.

**Porta 3000 ou 5173 ocupada.** Normalmente é uma execução anterior que ficou
para trás. Descubra o dono antes de encerrar qualquer coisa:

```bash
netstat -ano | findstr LISTENING | findstr :3000
```

**`JWT_SECRET` obrigatório / módulos bloqueados.** `NODE_ENV` ausente vale como
produção (falha fechada). Confirme que `backend/.env` tem
`NODE_ENV=development`.

**Erro de client desatualizado do Prisma.** Depois de mudar
`prisma/schema.prisma`, rode `npx prisma generate` (ou `npx prisma migrate dev`,
que já gera) e reinicie o backend.

## Scripts `.bat` (Windows)

Na raiz existem atalhos herdados: `start-db.bat` (Docker), `run-backend.bat` e
`run-frontend.bat`. O `start-db.bat` assume Docker; se você usa `prisma dev`,
siga a seção 1 deste guia em vez dele.
