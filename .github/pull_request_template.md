## O que muda

<!-- Resumo objetivo da mudanca e o porque. -->

## Como testar

<!-- Passos para validar localmente. Ex.: rotas afetadas, telas, comandos. -->

## Checklist

- [ ] `npm run build -w backend` e `npm run build -w frontend` passam
- [ ] Migracoes do Prisma incluidas quando o schema muda (`backend/prisma/migrations/`)
- [ ] Sem segredos, `.env` ou dados reais no diff
- [ ] E2e de balcao roda (`npm run test:e2e` em `backend/`) quando o fluxo de venda/caixa/fiscal muda
- [ ] Base da PR: `Dev` (feature) ou `main` (release)
