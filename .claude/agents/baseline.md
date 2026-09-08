# Baseline de segurança — catalog-crm

Arquivo vivo. O agente `revisor-seguranca` lê este arquivo antes de cada revisão
e propõe atualizações no fim do relatório. **Você** aplica as atualizações — o
agente não escreve arquivos.

Regras:

- Nada aqui é permanente. Todo risco aceito tem **data de revisão**; passou da
  data, volta a ser achado.
- Se o código divergir do que está escrito aqui, a divergência é achado.
- IDs `SEC-###` são estáveis e nunca reutilizados.

Última atualização: `2026-09-08` — por: `Claude (revisão da foto de produto)` —
revisão de referência: `204c380` + working tree (escopo desta passada: backend/src/products,
`product-images`, `inventory.service`, schema/migração da foto, `lib/image.ts`,
`ProductThumb`/`ProductPhotoField`, `Modal.tsx`, ProductsPage/PdvPage/InventoryPage)

> **Pendência conhecida:** os commits `6b551ba` (SEC-084..088) e `204c380`
> (SEC-090..097) fecharam achados que nunca foram registrados aqui. As linhas
> desses dois blocos continuam faltando — quem fizer a próxima passada deve
> extraí-las das mensagens de commit antes de tratar qualquer item como novo.
> Próximo ID livre: **SEC-105**.

> Primeira rodada real do `revisor-seguranca`. Relatório completo em
> `.claude/seguranca/relatorios/2026-09-04-acesso-usuarios-e-hooks.md`
> (não versionado — ver SEC-014). As linhas abaixo foram verificadas em leitura
> de código, no SQL das migrações e com o e2e verde; o que continua sem
> verificação está marcado **(não verificado)**.

---

## 1. Superfície e decisões de arquitetura

| Item | Estado atual | Observação |
|---|---|---|
| Monorepo | npm workspaces: `backend/`, `frontend/`; Node 20 (`.nvmrc`) | |
| Backend | NestJS 12 + Prisma 7 (`@prisma/adapter-pg`) + PostgreSQL | `prisma.config.ts` carrega o `.env` (o Prisma 7 não carrega sozinho) |
| Frontend | React 19 + Vite 8 + React Router 7 + TanStack Query + Zustand | |
| Banco de desenvolvimento | `prisma dev` local, portas 51213–51216 | sem Docker; `DATABASE_URL` aponta para `localhost` |
| Autenticação | JWT HS256, `expiresIn` 12h | `getJwtSecret()` falha fechada: `NODE_ENV` ausente vale como **produção** (SEC-010 corrigido em 2026-09-05). Os 3 usos de `NODE_ENV` no backend testam `=== 'development'` |
| Invalidação de sessão | ausente: sem `jti`/versão de token | redefinir senha ou desativar usuário **não** invalida JWT já emitido — ver SEC-002 |
| Autorização | `JwtAuthGuard` + `PermissionsGuard`, ambos `APP_GUARD` global | rota sem `@RequirePermissions` exige só autenticação |
| Modelo de permissão | **38 chaves** em `access/permission-catalog.ts`, sincronizadas no boot | papéis internos `ADMIN` (`'*'`), `GERENTE`, `OPERADOR`; papéis extras e exceções por usuário vivem no banco. `finance.accounts.manage` entrou em 2026-09-08. O recruzamento completo com os controllers é de 2026-09-05 — **refazer**, houve controllers novos desde então. `reports.view`/`reports.export` só para GERENTE e ADMIN |
| Relatórios | `reports/` atrás de `@RequireModule('relatorios')` no controller inteiro + `reports.view`; exportação CSV exige `reports.export` a mais | exportação **não liberável por vale de supervisor** (duas permissões faltando quebram a condição `missing.length === 1`). Leitura e exportação vão para o `AuditLog`. Teto de `MAX_ROWS = 2000` em produtos e estoque, com `truncado`/`limite` na resposta |
| Cache de permissão | `Map` em memória com TTL em `access.service.ts`, invalidado em mudança de papel/permissão | por processo; múltiplas instâncias divergem até o TTL |
| Delegação (vale de supervisor) | JWT curto (180 s), header `X-Authorization-Grant`, 1 permissão / 1 operador | **qualquer uma das 22 permissões pode ser liberada, inclusive `users.manage`** — ver SEC-011; uso único em `Map` em memória — ver SEC-003 |
| Ciclo de vida de usuário | criação, edição, papel, overrides, ativo/inativo, senha | **não existe rota de remoção**: o ciclo é desativação (`active = false`) |
| Configuração de sistema | tabela `AppSetting`, catálogo em `settings/setting-catalog.ts` | inclui os limites do rate limit de login — ver SEC-004 |
| Configuração da loja | `StoreSettings` (emitente, identidade visual, política de desconto) | |
| Token no cliente | `localStorage` (`store/authStore.ts`) | aceito enquanto não houver XSS conhecido — ver SEC-005 |
| Multi-loja | não | instalação por loja; nenhuma query filtra `storeId` |
| Licenciamento por módulos | chave Ed25519 assinada (`CATALOG-1.<payload>.<assinatura>`), verificada **offline** com `LICENSE_PUBLIC_KEY`; renovação online opcional por `LICENSE_RENEW_URL` | **novo segredo do produto**: a chave PRIVADA é do fornecedor, fica FORA do repositório (`~/.catalog-licencas/`) e quem a tiver emite licença para qualquer cliente. Catálogo em `license/module-catalog.ts`: núcleo + 5 acessórios |
| Gate de licença | `ModuleGuard` como `APP_GUARD` no **CommonModule**, entre Jwt e Permissions; `@RequireModule` nos controllers acessórios; e checagem no **ponto de aplicação** dentro de `SalesService` (promoção e fiscal) | o **núcleo nunca é bloqueado** — sem chave, com chave inválida ou vencida a loja continua vendendo. Tolerância de 15 dias após vencer. `NODE_ENV=development` libera tudo sem chave |
| Vínculo da chave | CNPJ do payload comparado com `StoreSettings.cnpj` na instalação e na renovação; renovação exige mesmo cliente e `emitidaEm` mais recente | chave sem CNPJ (avaliação/demonstração) vale em qualquer instalação, de propósito. **Não há revogação**: chave vazada só é neutralizada rotacionando `LICENSE_PUBLIC_KEY` e reemitindo para toda a base |
| Certificado A1 | não implementado | quando entrar, definir onde fica o PFX e como a senha é guardada |
| Upload de imagem | **foto de produto**: `PUT`/`DELETE /api/products/:id/image` sob `products.manage`; corpo é data URI (não multipart, sem `multer`). Logo da loja continua sendo URL em `StoreSettings` | recorte e recompressão acontecem no NAVEGADOR (`frontend/src/lib/image.ts`); o servidor reconfere bytes mágicos e tamanho (512 KB imagem / 64 KB miniatura) e recusa SVG. **Sem trilha de auditoria — ver SEC-099** |
| Foto de produto — entrega | `GET /api/product-images/:token` e `/:token/thumb`, **`@Public()`** | `<img src>` não manda `Authorization` e o token do app vive em `localStorage`: a proteção é o endereço opaco (16 bytes aleatórios, `@unique`), trocado a cada upload. `Cache-Control: immutable` + 304 conferido antes de tocar o banco; CORP `cross-origin` sobrescrevendo o helmet; teto de 600 req/min por IP. Bytes em `BYTEA` no Postgres. **O token é capability permanente: desativar um usuário não revoga a URL que ele já conhece** — por isso só foto de vitrine entra aqui, nunca imagem com dado pessoal |
| Importação de catálogo | CSV via `POST /api/products/import`, corpo JSON até 8 MB | `MAX_ROWS = 5000` aplicado antes de escrever; sem rota de exportação, logo sem sink de CSV injection hoje (verificado 2026-09-05) |
| Modo offline do PDV | não | |
| Porta de pagamento | `payments/` com `PAYMENT_GATEWAYS`: `CashPaymentProvider` (balcão) e `FakeElectronicProvider` (Pix/cartão simulados) | trava de produção pela positiva (`ALLOW_FAKE_PAYMENT_GATEWAY`); somente leitura — não há rota de estorno avulso, ver SEC-018 |
| Provedor fiscal | só `fake-fiscal.provider.ts`, amarrado por `useExisting` | **sem trava de produção**, e a chave `AppSetting fiscal.provider` não é lida por código nenhum — ver SEC-023 |
| Teto de gaveta | `AppSetting cash.drawerLimit`, em `/cash/current` e na leitura X | aviso operacional, nunca bloqueia venda |
| Trilha de auditoria | `AuditLog` append-only, garantido por FK `RESTRICT` no ator | cobertura completa das operações sensíveis: venda/cancelamento/devolução, permissões, caixa, estoque, configurações e promoções |
| Rate limit | `POST /auth/login` e `POST /access/authorize`, ambos por janela fixa em memória (`FixedWindowLimiter`) | some no restart e não vale para múltiplas instâncias |
| Promoções | `Promotion` + motor puro em `promotions/promotion-engine.ts`; desconto automático calculado **pelo servidor** na criação da venda | o PDV só simula (`POST /promotions/simulate`); `SaleItem` guarda snapshot de `promoDiscount`/`promotionId`/`promotionName`. Tela própria em `/promocoes` (guarda `promotions.manage`), também acessível como modal em *Configurações → Promoções*. Campanha da loja **não** consome o teto de desconto do operador — política revisada e mantida. `PATCH` é atualização parcial; a trilha grava antes/depois com valor. Sem tela de gestão no frontend ainda: campanhas nascem pela API |
| CORS em produção | allowlist por `CORS_ORIGIN` (default `http://localhost:5173`) | `credentials: true` |
| `helmet` | sim, `app.use(helmet())` em `main.ts` | CSP explícita no frontend: não |
| CI | `.github/workflows/ci.yml`: `npm ci`, `prisma generate`, build backend + frontend | **não roda testes, lint nem `npm audit`** — ver SEC-007 |
| Dependências | Dependabot semanal, major do TypeScript ignorado de propósito | |
| Testes | um e2e: `backend/test/checkout.e2e.ts` — **82 verificações, verde em 2026-09-05** | cobre venda, devolução, caixa, fiscal, permissões, vale de supervisor, ciclo de vida de usuário, porta de pagamento e teto de gaveta. NÃO cobre rate limit de `/access/authorize` nem trilha de mudança de papel/permissão. **Não cobre o gate de licença**: a suíte roda em `NODE_ENV=development`, onde todos os módulos ligam — SEC-039 a SEC-046 foram verificados manualmente em modo produção. Escreve no banco de desenvolvimento — ver SEC-017 |

---

## 2. Riscos aceitos (com prazo)

Formato: um bloco por risco. Sem "data de revisão", o item não é aceito — é
apenas ignorado, e isso não conta.

### SEC-001 — Vulnerabilidades `high` transitivas do `prisma@7`
- **O que é**: conjunto confirmado em 2026-09-04 por `npm audit --omit=dev`
  (4 `high`): `deepmerge-ts <8.0.0` (GHSA-ggr8-5vv4-36mx) via `@prisma/config`;
  `mysql2 <=3.23.0` (GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3).
- **Por que é aceito**: inalcançáveis. O projeto usa só PostgreSQL
  (`@prisma/adapter-pg` + `pg`); `mysql2` nunca é carregado em runtime e
  `deepmerge-ts` só entra pelo CLI do Prisma. O fix oferecido é
  `prisma@6.19.3` — regressão de major que quebra o build. **Não aplicar**
  `npm audit fix --force`.
- **Condição de reabertura**: qualquer uma virar dependência direta, passar a
  ser alcançável em runtime, mudar de contagem/severidade, ou o Prisma publicar
  correção.
- **Aceito em**: `<aguardando aceite do dono do projeto>` — por: `<preencher>`
- **Revisar até**: `2026-12-03` (90 dias)
- **Atenção**: enquanto a linha "Aceito em" não for preenchida por uma pessoa,
  pela regra deste arquivo o item **não está aceito** — está apenas ignorado.

---

## 3. Achados abertos (não corrigidos, não aceitos)

| ID | Sev. | Título | Local | Aberto em | Dono | Situação |
|---|---|---|---|---|---|---|
| SEC-011 | Médio | Vale de supervisor pode liberar `users.manage`/`settings.manage`, virando privilégio permanente | `backend/src/access/authorization.service.ts:64` | 2026-09-04 | | em aberto |
| SEC-012 | Médio | Papel padrão do formulário de novo usuário é Administrador | `frontend/src/components/UsersPermissionsModal.tsx` | 2026-09-04 | | em aberto |
| SEC-002 | Médio | JWT sem `jti`/versão — agravado: a redefinição de senha criada hoje não invalida o token do invasor | `backend/src/common/jwt.strategy.ts` | 2026-09-04 | | em aberto |
| SEC-003 | Médio | Uso único do vale vive em `Map` em memória: restart reabilita vale ainda dentro do TTL | `backend/src/access/authorization.service.ts` | 2026-09-04 | | em aberto |
| SEC-004 | Médio | `login.rateLimit.max` editável até 1000 por quem tem `settings.manage` | `backend/src/settings/setting-catalog.ts` | 2026-09-04 | | em aberto |
| SEC-007 | Médio | CI não roda `npm audit`, testes nem lint | `.github/workflows/ci.yml` | 2026-09-04 | | em aberto |
| SEC-015 | Baixo | `JwtStrategy` sem `algorithms` explícito e sem rejeitar `typ='grant'` | `backend/src/common/jwt.strategy.ts:16` | 2026-09-04 | | em aberto |
| SEC-016 | Baixo | `StockMovement.userId` e `CashMovement.userId` em `ON DELETE SET NULL`: autoria de ajuste de estoque e de movimento de caixa some em silêncio se um dia existir rota de remoção de usuário | `backend/prisma/schema.prisma:281,508` | 2026-09-04 | | latente (sem gatilho hoje) |
| SEC-017 | Baixo | `checkout.e2e.ts` apaga linhas de `AuditLog` — inclusive por `approverId`, atingindo trilha de terceiros — para conseguir remover o usuário de teste | `backend/test/checkout.e2e.ts:491` | 2026-09-04 | | em aberto |
| SEC-022 | Médio | Pagamento `NEGADO`/`PROCESSANDO` sem reconciliação nem retry. X/Z e dashboard já não somam o valor e há `unsettledPayments`, mas **ninguém o renderiza** (`CashPage.tsx` mostra só `byPaymentMethod`), não há rota de reprocesso (ao contrário do fiscal) e um `PROCESSANDO` preso não tem saída. **Sem cobertura de e2e**: o provedor simulado não nega por entrada alcançável pela API (`@IsPositive` barra o insumo), então cobrir o caminho exige um provedor de teste injetável | `backend/src/payments/payments.service.ts`; `frontend/src/pages/CashPage.tsx` | 2026-09-04 | | parcial |
| SEC-023 | Médio | Provedor fiscal simulado sem trava de produção, e `AppSetting fiscal.provider` não é lido por código nenhum (controle de fachada) | `backend/src/fiscal/fiscal.module.ts:12`; `backend/src/settings/setting-catalog.ts:78` | 2026-09-04 | | parcial (lado pagamentos corrigido) |
| SEC-005 | Baixo | JWT em `localStorage`: qualquer XSS vira roubo de sessão | `frontend/src/store/authStore.ts` | 2026-09-04 | | aceito enquanto não houver XSS conhecido |
| SEC-006 | Baixo | `fiscal.provider` configurável no banco: vira caminho de SSRF quando entrar provider real com URL | `backend/src/fiscal/providers/` | 2026-09-04 | | preventivo |
| SEC-047 | Alto | Cancelamento de venda sem trava otimista: dois cancelamentos simultâneos duplicam o estorno de estoque e a sangria de caixa | `backend/src/sales/sales.service.ts:404-471` | 2026-09-05 | | em aberto |
| SEC-048 | Alto | Devolução valida o saldo devolvível fora da transação: devolve mais do que foi vendido, com dinheiro saindo da gaveta duas vezes | `backend/src/sales/sales.service.ts:553-673` | 2026-09-05 | | em aberto |
| SEC-049 | Médio | `GET /sales` e `GET /sales/:id` devolvem `Payment` cru e contornam o mascaramento de `qrCode`/`externalId` de SEC-025 | `backend/src/sales/sales.service.ts:53,65` | 2026-09-05 | | em aberto |
| SEC-050 | Médio | `POST /auth/login` com `bcrypt.compareSync` e sem hash falso: enumeração de usuário por tempo e bloqueio do event loop (correção de SEC-008 não propagada) | `backend/src/auth/auth.service.ts:21` | 2026-09-05 | | em aberto |
| SEC-051 | Baixo | Rate limit de login sem chave só-username: todas as chaves incluem o IP | `backend/src/common/login-rate-limit.guard.ts:42` | 2026-09-05 | | em aberto |
| SEC-052 | Baixo | `CreateReturnDto.items` sem `@ArrayMaxSize` — lacuna da remediação de SEC-031 | `backend/src/sales/dto/create-return.dto.ts:26` | 2026-09-05 | | em aberto |
| SEC-053 | Baixo | CPF de cliente em query string (`GET /customers?search=`): fica em log de proxy e histórico do terminal | `frontend/src/lib/api-client.ts:265` | 2026-09-05 | | em aberto |
| SEC-054 | Baixo | Criação de venda e de devolução sem chave de idempotência: retry duplica venda, estoque e numeração de NFC-e | `backend/src/sales/sales.controller.ts:37,64` | 2026-09-05 | | em aberto |
| SEC-055 | Médio | Relatório de vendas somava venda com pagamento negado/pendente sem declarar: divergia do X/Z e do próprio relatório de pagamentos | `backend/src/reports/reports.service.ts` | 2026-09-05 | 2026-09-05 | corrigido — resposta expõe `naoLiquidado` (valor e contagem) e a tela explica a diferença |
| SEC-056 | Médio | `/reports/inventory` e `/reports/products` sem teto de linhas: DoS autenticado e CSV montado inteiro em memória | `backend/src/reports/reports.service.ts` | 2026-09-05 | 2026-09-05 | corrigido — `MAX_ROWS = 2000` com `truncado`/`limite` na resposta e aviso na tela |
| SEC-057 | Baixo | Consulta de relatório não auditada: custo, margem e desempenho por operador saíam em JSON com só `reports.view`, sem rastro (LGPD art. 37) | `backend/src/reports/reports.controller.ts` | 2026-09-05 | 2026-09-05 | corrigido — `auditRead` grava `AuditLog` em produtos, categorias, operadores e estoque |
| SEC-058 | Baixo | `RISKY_PREFIX` incluía `-`: todo número negativo do CSV virava texto no Excel e ficava fora do total | `backend/src/reports/csv.ts` | 2026-09-05 | 2026-09-05 | corrigido — coluna `numeric: true` não passa pela neutralização |
| SEC-059 | Baixo | Margem por categoria contava produto sem custo como margem zero, subestimando o percentual sem avisar | `backend/src/reports/reports.service.ts` | 2026-09-05 | 2026-09-05 | corrigido — `receitaComCusto` como denominador, `produtosSemCusto` por categoria e `margemPercentual` nulo quando não há custo |
| SEC-060 | Baixo | Bloco `recusados` do relatório de pagamentos não filtrava `sale.status`: estorno de cancelamento aparecia como falha de maquineta | `backend/src/reports/reports.service.ts` | 2026-09-05 | 2026-09-05 | corrigido — filtra `status: 'CONCLUIDA'` como o bloco de faturamento |
| SEC-099 | **Alto** | Nenhuma rota de `products/` deixa trilha (inclusive alteração de preço e custo), e todas são liberáveis por vale de supervisor: um vale pedido "para arrumar a foto" serve para `PATCH /products/:id {price}` | `backend/src/products/products.service.ts`; `backend/src/products/product-images.service.ts` | 2026-09-08 | | **em aberto** |
| SEC-098 | Médio | `GET /api/product-images/:token` público e sem teto: cada acerto trazia até 512 KB e segurava uma das 4 conexões do pool do PDV; o `ETag` era decorativo (`res.end` não gera 304) | `backend/src/products/product-images.controller.ts` | 2026-09-08 | 2026-09-08 | corrigido — `ProductImageRateLimitGuard` (600/min por IP) e 304 conferido **antes** da consulta. Permanece por decisão: o token é capability permanente (registrado na seção 1) |
| SEC-100 | Baixo | `Content-Type` da miniatura herdado do arquivo grande: o header não descrevia os bytes servidos quando os formatos diferiam | `backend/src/products/product-images.service.ts` | 2026-09-08 | 2026-09-08 | corrigido — `set()` recusa quando `image` e `thumb` têm formatos diferentes (o editor já usa o mesmo codec nas duas) |
| SEC-101 | Baixo | `imageUrl` sem `@IsUrl`/`@MaxLength`, agora renderizado como `<img>` em Produtos, Estoque e PDV: pixel de rastreamento de terceiro no balcão | `backend/src/products/dto/create-product.dto.ts`; `frontend/src/components/ProductThumb.tsx` | 2026-09-08 | 2026-09-08 | corrigido — `@IsUrl({ protocols: ['https'] })` + `@MaxLength(500)` nos dois DTOs, e `productPhotoUrl` descarta reserva externa que não seja `https:` |
| SEC-102 | Baixo | Foco inicial do `Modal` reexecutava a cada render (`[onClose]` com arrow inline): o cursor saltaria para o primeiro campo a cada tecla no formulário de produto | `frontend/src/components/Modal.tsx` | 2026-09-08 | 2026-09-08 | corrigido — foco inicial e devolução de foco em efeito próprio com `[]`; Esc e trava de scroll seguem em `[onClose]` |
| SEC-103 | Baixo | `readImage` aceitava `image/svg+xml` por arrastar/colar (o `accept` do seletor não cobre esses caminhos) | `frontend/src/lib/image.ts` | 2026-09-08 | 2026-09-08 | corrigido — SVG recusado explicitamente antes da leitura |
| SEC-105 | Baixo | Sem cota para o armazenamento de fotos: ~576 KB por produto em `BYTEA`, até ~2,8 GB no teto de 5.000 linhas do importador, viajando em todo `pg_dump`. `byteSize` é gravado e nunca somado | `backend/src/products/product-images.service.ts` | 2026-09-08 | | em aberto |
| SEC-104 | Baixo | `baseline.md` divergente do código: parava em SEC-065, dizia 26 permissões (são 38) e "sem rota de upload no backend" (há duas) | `.claude/agents/baseline.md` | 2026-09-08 | 2026-09-08 | corrigido em parte — seção 1 e seção 5 atualizadas nesta passada; as linhas de SEC-084..097 continuam faltando (ver aviso no cabeçalho) |

---

## 4. Corrigidos (histórico curto)

| ID | Título | Corrigido em | Commit | Teste de regressão |
|---|---|---|---|---|
| SEC-018 | Estorno avulso sem escopo: contornava turno fechado, estado da venda e posse; usava `sales.cancel`, que o vale de supervisor libera | 2026-09-04 | (working tree) | rota `POST /payments/:id/refund` **removida** — estorno só pelo cancelamento, coberto pelo e2e |
| SEC-019 | Estorno de DINHEIRO sem `CashMovement`: gaveta acusaria falta e a trilha justificaria o buraco | 2026-09-04 | (working tree) | idem — o cancelamento lança a `SANGRIA` e o e2e verifica |
| SEC-020 | Estorno por vale sem `approverId` na trilha | 2026-09-04 | (working tree) | idem — o cancelamento já registra quem liberou |
| SEC-009 | Trilha de auditoria não cobria as operações que movem permissão, dinheiro em espécie, estoque e configuração | 2026-09-05 | (working tree) | fechado por completo: papel/overrides/ativo (com antes/depois), sangria/suprimento, fechamento de caixa com divergência, `store-settings`, `app-settings`, promoções e, por último, `inventory.adjust`. Teste: "ajuste de estoque entra na trilha com tipo, quantidade e motivo" |
| SEC-034 | Vírgula decimal virava `null`; `@IsOptional` (reaplicado por `PartialType`) pulava a validação e o merge devolvia 200 mantendo o desconto antigo — a tela confirmava um preço que a loja não praticava | 2026-09-05 | (working tree) | parser próprio no cliente (não o `toNumber`, que mascara erro como `0`), botão travado com número inválido, e barreira explícita no service recusando `null` em campo não anulável. Teste: "valor nulo no PATCH e recusado, nao aceito em silencio" |
| SEC-035 | Gestão de promoções só alcançável por `settings.manage`: o GERENTE tem `promotions.manage` e a saída prática era conceder o pacote de configuração (CSC, teto de desconto, rate limit) | 2026-09-05 | (working tree) | rota `/promocoes` com guarda `promotions.manage`, entrada própria no menu, e o corpo da tela extraído para `PromotionsManager` |
| SEC-036 | `fromForm` omitia campo limpo e o merge o restaurava: vigência e quantidade mínima não podiam ser removidas | 2026-09-05 | (working tree) | `null` explícito = limpar; `undefined` = manter. Teste: "campo limpavel aceita null e some de verdade" |
| SEC-037 | Tela de promoções não mostrava erro da lista nem do toggle: 403 aparecia como "0 campanha(s)" | 2026-09-05 | (working tree) | estado de erro renderizado na lista e `onError` no toggle |
| SEC-038 | `PERDA` com quantidade negativa somava ao estoque e entrava na trilha como perda; `reason` sem limite | 2026-09-05 | (working tree) | `@Min(0)` e `@MaxLength(300)`. Teste: "ajuste com quantidade negativa e recusado" |
| SEC-029 | `PATCH /promotions/:id` era substituição total: campo omitido voltava ao default, e corrigir o nome de uma campanha encerrada a ressuscitava perpétua | 2026-09-05 | (working tree) | `UpdatePromotionDto extends PartialType(...)` + merge com a linha existente, validando o estado final. Teste: "PATCH parcial preserva vigencia, prioridade e estado da campanha" |
| SEC-030 | Trilha de promoções sem valores e `delete` sem cópia da regra: campanha apagada não deixava evidência do que precificou a venda | 2026-09-05 | (working tree) | `promotions.update` grava `de`/`para` por campo alterado; `promotions.delete` grava a regra inteira. Teste: "trilha de promocao registra o valor alterado, nao so o nome do campo" |
| SEC-031 | Array sem teto em `/promotions/simulate` e `/sales`: DoS autenticado que parava o backend da loja | 2026-09-05 | (working tree) | `@ArrayMaxSize(200)` nos itens e `(20)` nos pagamentos. Teste: "simulacao recusa carrinho absurdo e aceita o normal" |
| SEC-032 | `Product.price` lido duas vezes fora de transação: alteração concorrente de preço podia zerar o item | 2026-09-05 | (working tree) | `computeForCart` recebe o carrinho que a venda já leu; a segunda consulta sumiu |
| SEC-033 | PDV descontava a promoção do subtotal global enquanto o servidor limita por linha: tela podia mostrar total negativo | 2026-09-05 | (working tree) | cap por linha no cliente, espelhando o servidor |
| SEC-008 | `POST /access/authorize` sem rate limit nem auditoria de falha | 2026-09-05 | (working tree) | `GrantRateLimitGuard` (5 tentativas / 5 min por operador, IP e alvo, configurável em `authorize.rateLimit.*`), `AuditLog` de `authorization.denied` em toda recusa e `bcrypt.compare` assíncrono. Teste: "rate limit corta o brute force da senha de supervisor" |
| SEC-010 | `NODE_ENV` ausente valia como desenvolvimento: segredo de JWT versionado e seed destrutivo destravados | 2026-09-05 | (working tree) | default invertido em `jwt-secret.ts` e `seed.ts` — ausência agora vale como produção (falha fechada). `NODE_ENV` documentado em `backend/.env.example` |
| SEC-021 | Estorno sem trava otimista; recusa do provedor devolvida como sucesso | 2026-09-04 | (working tree) | claim `updateMany` sobre `REFUNDABLE`, restauração do status e `AuditLog` de `payments.refund.failed` **nos dois ramos** (recusa e exceção) |
| SEC-026 | Dashboard somava pagamento negado/pendente como faturamento — a correção do X/Z não tinha sido aplicada lá | 2026-09-04 | (working tree) | mesmo filtro `status in (AUTORIZADO, CONFIRMADO)` em `dashboard.service.ts` |
| SEC-027 | Estorno que falha por exceção não deixava trilha; venda cancelada sai do X/Z, então o dinheiro não devolvido era invisível | 2026-09-04 | (working tree) | `recordFailure` comum aos dois ramos; `refundSale` devolve os não estornados e `cancel` grava `sales.cancel.refundPending` |
| SEC-028 | Trava de produção documentada no `.env.example` errado; mensagem oferecia o bypass como alternativa de mesmo peso | 2026-09-04 | (working tree) | `NODE_ENV` e `ALLOW_FAKE_PAYMENT_GATEWAY=false` em `backend/.env.example`; mensagem reescrita |
| SEC-024 | `rejectionReason` persistia `err.message` cru e era impresso no PDV | 2026-09-04 | (working tree) | mensagem fixa; detalhe só no `Logger` |
| SEC-025 | `GET /payments/sale/:id` devolvia `Payment` cru | 2026-09-04 | (working tree) | `select` explícito, `qrCode` mascarado após liquidação, `externalId` fora — e2e "consulta posterior mascara o QR ja liquidado" |
| SEC-013 | Hooks de sessão: temp file previsível, `session_id` sem validação e nomes de arquivo do git no canal de instrução do modelo | 2026-09-04 | (working tree) | revisão do próprio script — `mktemp` + `trap`, `case` de allowlist no `sid`, lista higienizada e delimitada como dado |
| SEC-014 | `.claude/seguranca/relatorios/` versionado: achados abertos viajariam com o repositório | 2026-09-04 | (working tree) | `git status --porcelain -uall .claude/seguranca/` deve listar só o `README.md` |
| SEC-061 | Alto — Credenciais `admin`/`admin` pré-preenchidas em `LoginPage.tsx` e presentes no bundle de produção; o `autoFocus` da revitalização de UI reduzia a exploração a um Enter | 2026-09-07 | (working tree) | `frontend/src/pages/LoginPage.tsx` nasce com os dois campos vazios; usuário só é pré-preenchido quando `import.meta.env.DEV` **e** `VITE_DEV_USER` existem; senha nunca. `grep -c 'useState("admin")' frontend/dist/assets/*.js` retorna 0 (verificado nesta sessão). Residual operacional: cada instalação já semeada deve trocar a senha do `admin` — remover a linha não muda senha existente |
| SEC-062 | Baixo — Anel de foco global com contraste abaixo de 3:1 (WCAG 2.4.11) e `outline: none` sem fallback em `forced-colors` | 2026-09-07 | (working tree) | `--ring` a alpha 0.75 (escuro) / 0.60 (claro); bloco `@media (forced-colors: active)` com `outline: 2px solid Highlight` cobrindo `:focus-visible` e os campos `.field`/`.auth-form`/`.report-date`. Checklist manual por rodada: Tab na tela de login e no PDV com tema claro e alto contraste do Windows |
| SEC-063 | Baixo — Primitivo `.skeleton` global sem `aria-busy`; `visibility: hidden` tirava os filhos da árvore de acessibilidade; `color: transparent !important` em nome de classe genérico | 2026-09-07 | (working tree) | `.skeleton` sem `!important`; `.stats-grid` do Dashboard com `aria-busy={isLoading}`, `<article aria-hidden={isLoading}>` e `<span class="sr-only" role="status">` de carga; utilitário `.sr-only` adicionado. Sugestão de teste de renderização do Dashboard em carga verificando `aria-busy="true"` |
| SEC-064 | Baixo — Token `--accent` usado sem definição: `PromotionsModal.css` e `FinancePage.css` caíam em `#0e6e6e` fixo e ignoravam o tema | 2026-09-07 | (working tree) | `--accent` definido como alias de `--primary` nos dois blocos de tema em `styles.css`; os `var(--accent, #0e6e6e)` remanescentes passam a resolver pelo token |
| SEC-065 | Baixo — `--border` do tema claro reduzido a alpha 0.10: contorno de campo abaixo de 3:1 (WCAG 1.4.11) | 2026-09-07 | (working tree) | `--border` do tema claro revertido a 0.12; token novo `--border-field` (~3:1: `rgba(15,23,42,0.32)` claro, `rgba(148,163,184,0.34)` escuro) aplicado em `.field`/`.field-input`/`.auth-form input`/`.report-date`. Mesmo checklist visual da Rodada 2 |

Regra: todo achado **Crítico** ou **Alto** só sai daqui com um teste automatizado
apontado na última coluna. Sem teste, ele volta. (SEC-013 e SEC-014 são Baixos e
não automatizáveis de forma barata — a verificação apontada é manual, e isso é
declarado de propósito.)

---

## 4b. Decisões deliberadas (revisadas, com justificativa)

Registro do que foi decidido **contra** uma recomendação de revisão, para que a
próxima rodada discuta o mérito em vez de redescobrir o assunto do zero. Isto é
contexto, não dispensa de análise: se a premissa mudar, o item volta a ser achado.

### SEC-008 — 401 e 403 continuam distintos no `POST /access/authorize`
A revisão de 2026-09-04 pediu para unificar as duas respostas, porque o 403
("supervisor sem a permissão") confirma que a senha estava certa. Mantive
distinto, e a revisão de 2026-09-05 examinou e concordou. Razões:

- O oráculo não abre canal novo: `POST /auth/login` já confirma senha de forma
  definitiva. O 403 só acrescenta orçamento de tentativa num segundo balcão.
- Com o rate limit em 5 por janela, esse orçamento extra é irrelevante contra
  qualquer senha que não seja trivial — e senha trivial cai pelo login.
- Em troca, toda recusa passou a ser **auditada com motivo e IP**. Detecção
  concreta vale mais que indistinguibilidade marginal.
- O custo de UX era real: "senha inválida" quando o problema é "esse gerente não
  aprova desconto" manda o supervisor trocar a senha ou chamar o suporte.

**Premissas de que a decisão depende** — se qualquer uma cair, reabrir:
o `GrantRateLimitGuard` no lugar, a trilha de `authorization.denied` gravando, e
o teto de `authorize.rateLimit.max` baixo (hoje `max: 20` no catálogo).
Endurecimento já aplicado junto: o 403 não devolve mais o nome do aprovador.

---

## 5. Verificado OK recorrente

- **Núcleo nunca depende de licença**: `LicenseService.allows` responde `true` para `core`
  antes de qualquer consulta, e as rotas de venda/caixa não têm `@RequireModule`.
  Verificado em modo produção: com chave que libera só `fiscal`, `/promotions` e
  `/dashboard/summary` deram 403 enquanto `/sales` e `/cash/current` deram 200.
- **Chave adulterada é recusada** antes de entrar no banco (`PUT /settings/license` → 400),
  e a renovação online revalida a assinatura da chave que vem da rede — servidor de
  licenças comprometido não planta entitlement.
- **`LICENSE_RENEW_URL` vem do ambiente, nunca de dado de usuário ou do banco**, exige
  https fora de desenvolvimento e não segue redirect: é o que impede a rotina de renovação
  de virar SSRF.

- **Promoção é decisão do servidor**: `SalesService.create` recalcula com a mesma
  função da simulação (`PromotionsService.computeFor`); o cliente manda só produto e
  quantidade. Coberto por e2e que paga o valor já promocionado menos um centavo e
  espera 400.
- **Promoções não se acumulam**: uma regra por linha, maior `priority` vence, empate
  desempata pelo maior desconto — evita duas regras de 50% zerarem o item.
- **Teto do operador conta só o desconto que ele concede**: campanha agressiva da loja
  não trava o caixa (e2e com campanha de 50% e operador sem `discountOverride`).

Pontos sensíveis já conferidos e corretos. O revisor confirma em uma linha em vez
de reinvestigar do zero — mas reinvestiga se o arquivo mudou.

- **Cobertura de `@RequirePermissions`**: todas as rotas dos 18 controllers
  (incluindo os quatro mais novos — `payments`, `promotions`, `license`,
  `reports`) recruzadas com o catálogo em 2026-09-05 — nenhuma rota sensível sem
  decorator; todas as chaves usadas existem no catálogo; as 26 chaves estão
  distribuídas entre os papéis. Só-autenticadas: `GET /access/me`, `POST /access/authorize`,
  `PUT /access/me/password`, `GET /app-settings/public`, `GET /license/status`.
  `@Public()` só em `POST /auth/login`, `GET /health` e
  `GET /store-settings/branding` (que devolve apenas nome fantasia, razão social
  e as duas URLs de logo).
- **Ausência de papel privilegiado no código**: a única ocorrência de `user.role`
  no monorepo é a montagem do payload e da resposta de login. Nenhum
  `role === 'ADMIN'` em lugar nenhum — a promessa da arquitetura se sustenta.
- `access/access.service.ts` — `USER_SELECT` nunca expõe `passwordHash`; sem mass
  assignment nas rotas de usuário (campos escolhidos um a um); `bcrypt` com 10
  rounds; senha mínima de 8 validada no DTO e no service; `username` por regex de
  allowlist; `@@unique` cobre a corrida do check-then-act.
- **Troca da própria senha** exige a senha atual conferida com `bcrypt.compare`,
  e não há caminho para trocar a de outro sem `users.manage`.
- **`AuditLog` append-only garantido pelo banco, não só por convenção**: a FK
  `AuditLog_actorId_fkey` é `ON DELETE RESTRICT`
  (`20260904092228_payment_status_and_audit/migration.sql:42`); `approverId` é
  `SET NULL`, o que preserva a linha. Nenhum `update`/`delete` no código de
  produção e nenhuma rota `@Delete` de usuário existe. Contraste coerente:
  `UserPermission.user` é `CASCADE` — configuração acompanha o usuário, evidência
  não.
- **Vale de supervisor**: aprovador precisa ter ele próprio a permissão, não pode
  ser o próprio operador, mensagem única no 401, `typ`/`sub`/`permission`
  conferidos, `missing.length === 1` impede liberar rota de duas permissões, e o
  header é anexado no frontend apenas à requisição alvo (`grantHeader` em
  `api-client.ts`), nunca no cliente base.
- `sales/sales.service.ts` — **em `create`**: preço unitário sempre do banco,
  total recalculado, desconto do item limitado ao bruto, teto de `StoreSettings`
  aplicado a quem não tem `sales.discountOverride`, pagamento eletrônico não gera
  troco, `pg_advisory_xact_lock` na numeração e baixa de estoque por `updateMany`
  condicional (`quantity: { gte: qty }`) com verificação de `count`. Tudo em
  `Decimal`. **`cancel` e `createReturn` NÃO têm a mesma proteção** — ver
  SEC-047 e SEC-048.
- `CashService.current/addMovement` — escopo por `operatorId`: um usuário nunca
  lê nem movimenta o turno de outro.
- **Segredos**: nenhum `.env` jamais versionado
  (`git log --diff-filter=A -- "*.env"` vazio); nenhum `.pfx`/`.p12`/`.pem`/`.key`
  rastreado; no backend, nenhuma constante de segredo além do `DEV_FALLBACK`
  (SEC-010). No frontend houve uma credencial embutida (`admin`/`admin` em
  `LoginPage.tsx`) — corrigida em 2026-09-07, ver SEC-061; a varredura de
  segredos passa agora a cobrir constantes em JSX, não só backend e `.env`.
- `frontend/src/styles.css` — camada de tokens da revitalização de UI
  (2026-09-07): sem `@import`/`url()` remoto, sem fonte de terceiro (o
  `--font-sans` é só pilha local), contraste AA de texto conferido por cálculo
  nos dois temas, `prefers-reduced-motion` global cobrindo todos os `.css` por
  `!important`, `z-index` inteiramente tokenizado com `--z-modal` (70) acima do
  `.sidebar-toggle` (60).
- `main.ts` — `helmet()`, `trust proxy 1`, CORS por allowlist, `ValidationPipe`
  com `whitelist` + `forbidNonWhitelisted` + `transform`.
- `frontend/UsersPermissionsModal.tsx` — senhas só em `useState` local, nunca em
  Zustand persistido, `localStorage` ou console; estado zerado no `onSuccess`;
  nenhum `dangerouslySetInnerHTML`.
- **Trava otimista de `authorizeOne`** (`payments.service.ts`): `updateMany` condicional em
  `status: 'PENDENTE'` fecha a corrida de dupla autorização; a simétrica existe no estorno.
- **Chamada a provedor de pagamento fora da transação da venda**, como já era na emissão fiscal.
- **`PaymentsModule` falha fechada**: fora de `NODE_ENV=development` exige
  `ALLOW_FAKE_PAYMENT_GATEWAY=true`; verificado bootando `dist/main.js` sem a flag (exit 1).
- **X/Z e dashboard só contam o que entrou**: os dois `groupBy` filtram
  `status in (AUTORIZADO, CONFIRMADO)`; o X/Z expõe `unsettledPayments` à parte (ainda não
  renderizado — SEC-022). `revenueToday` continua somando `Sale.total` independentemente do
  desfecho do pagamento, o que é o núcleo aberto de SEC-022.
- **Estorno deixa rastro nos dois desfechos ruins**: recusa do provedor e exceção gravam
  `payments.refund.failed`, e o cancelamento registra `sales.cancel.refundPending` quando algum
  pagamento não voltou — a venda cancelada sai do escopo do X/Z, então a trilha é o único lugar.
- **`authorizationCode`/NSU no recibo não é dado sensível** — é o número de conciliação que o
  cliente confere. **`GET /payments/sale/:id` mascara o `qrCode` liquidado e omite
  `externalId`. As rotas `GET /sales` e `GET /sales/:id` não** — ver SEC-049.
- **Telas de pagamento sem XSS**: `SaleReceipt.tsx`, `SalesPage.tsx` e `CashPage.tsx` por JSX.
- `access/permission-catalog.ts` — fonte única das permissões; `ADMIN` usa `'*'`,
  então permissão nova não deixa o administrador de fora por esquecimento.
- **Foto de produto — o que já está certo** (2026-09-08): os bytes nunca saem em
  listagem (`PRODUCT_INCLUDE` traz só `token` e `withPhoto()` descarta o registro
  cru — verificado nos seis pontos de leitura de `products.service.ts` e no
  `inventory.service.ts`); `bytes()` seleciona só a variante pedida; o tipo é
  apurado por bytes mágicos e reconferido contra o declarado, sem ramo de
  aceitação para SVG; os tetos do DTO cortam antes da decodificação e os do
  service depois; token inválido é barrado por regex antes de virar consulta; o
  token não entra no log de acesso (`routeOf` registra `/product-images/:token`);
  `assetUrl` só deixa passar `^https?://`, o que torna `javascript:`/`data:`
  inertes mesmo se plantados em `imageUrl`; e todo o caminho novo do frontend é
  JSX, sem `dangerouslySetInnerHTML`. Não há `multer`/`FileInterceptor` no
  projeto: o upload é data URI validado no service.
- **Importação de CSV com teto de 5.000 linhas** (`MAX_ROWS`) aplicado antes de
  qualquer escrita; colunas desconhecidas caem fora do mapa de aliases e são
  ignoradas. **A rota de exportação passou a existir**
  (`GET /reports/export/:report`) e já nasceu com a neutralização recomendada:
  `reports/csv.ts` prefixa `'` em células de origem livre iniciadas por
  `= + - @ TAB CR` e faz o quoting de `" ; 
 
`. Coluna numérica é declarada
  com `numeric: true` e **não** passa pela neutralização — prefixar um negativo
  faria o Excel ler `'-123,45` como texto, e o prejuízo sumiria do total. O
  `:report` é conferido contra allowlist antes de compor o `Content-Disposition`
  e `safeFilename` reduz o nome a `[A-Za-z0-9._-]`: injeção de header fechada em
  três camadas.
- **Módulo `relatorios`**: o gate de licença está no controller inteiro, não
  rota a rota — rota nova não escapa por esquecimento. `dashboard.view` e
  `reports.*` apontam para o mesmo módulo no backend (`license/module-catalog.ts`)
  e no espelho do frontend (`lib/useLicense.ts`), conferidos idênticos em
  2026-09-05. **Atenção estrutural**: são duas listas mantidas à mão; divergência
  entre elas oferece ao lojista um botão que responde 403.
- **Menu lateral (`components/Layout.tsx`) filtra por permissão E por módulo
  licenciado**; as chaves do menu, do `Guard` em `App.tsx` e do
  `@RequirePermissions` do backend batem para todas as rotas — recruzado em
  2026-09-05, inclusive depois da remodelagem em grupos recolhíveis.
- **Busca de produto por trigram é `$queryRaw` com template tag**
  (`products.service.ts`): `term`, `categoryId` e `onlyActive` entram como
  parâmetros, não por interpolação. Nenhum `$queryRawUnsafe`/`$executeRawUnsafe`
  no repositório.

---

## 6. Fora de escopo do revisor

Coisas que o agente não cobre e que precisam de outro controle:

- Segurança de infraestrutura e rede (firewall, TLS, backup do banco)
- Segurança física do terminal de PDV e da gaveta de dinheiro
- Revisão do provedor fiscal terceirizado
- Conformidade fiscal propriamente dita (layout da NFC-e, regras da SEFAZ)
- Segurança do processo de emissão de licença (`license/`) fora do código
- As próprias instruções do agente (`revisor-seguranca.md`, `guia-de-uso.md`):
  o revisor não avalia o que o define — isso é revisão humana
