# Roadmap — Revitalização de UI/UX

Revitalização **ampla** da interface, **evoluindo a identidade atual**
(azul-índigo sobre fundo escuro) em vez de repaginar cores. O trabalho é
incremental: cada rodada entrega um recorte coeso, buildável e verificado, e
este arquivo é atualizado junto com a entrega.

Diretrizes fixas:

- **Sem regressão de comportamento.** A revitalização mexe em CSS e em JSX de
  apresentação; regras de negócio, permissões, chamadas de API e textos ao
  usuário ficam de fora.
- **Tudo sai de token.** Nenhuma cor, raio, sombra ou espaçamento em hex/px
  solto nas regras — só `var(--…)` das escalas de `styles.css`.
- **Acessibilidade é requisito, não enfeite:** foco visível no teclado,
  `prefers-reduced-motion`, rótulos associados, contraste AA.
- **Compatibilidade de nomes.** Toda classe e todo token que já existia continua
  existindo; a revitalização refina valores e adiciona, não renomeia.
- Portão de saída de cada rodada: `npm run build -w frontend` verde +
  revisão do subagente `revisor-seguranca` sobre o diff.

---

## Rodada 1 — Fundação do sistema + casca + telas de entrada ✅

Entregue em 2026-09-07.

- **Camada de tokens reescrita** (`frontend/src/styles.css`):
  - Escalas neutras novas: `--space-1..10`, `--radius-xs..pill`,
    `--dur-fast/base` + `--ease`, `--shadow-sm/md/lg`, `--z-*`.
  - Paleta escura e clara refinadas: separação de elevação entre `--surface`,
    `--surface-2/3/4`, borda em dois pesos (`--border`, `--border-strong`),
    texto em rampa (`--text-strong/soft`, `--muted`).
  - Tokens semânticos que faltavam e eram preenchidos por _fallback_ em hex
    fixo nas folhas de página: `--danger`, `--ok`, `--text-muted`,
    `--muted-text`, `--surface-muted`, `--ring`. Com isso Dashboard, PDV, Caixa
    e Vendas passaram a responder ao tema sem alteração própria.
- **Base acessível e consistente:**
  - `:focus-visible` único para todo elemento interativo (só no teclado).
  - `prefers-reduced-motion` agora corta transições/animações do app inteiro,
    não só da sidebar.
  - `::selection`, barra de rolagem discreta no tom do tema, `::placeholder`
    padronizado.
  - Tipografia: corpo em peso 400 (era 500), títulos 650 com _tracking_
    negativo — mais legível e menos "pesado".
- **Casca (sidebar / navegação):** item ativo ganha traço vertical no tom da
  marca, transições suавes com token de _easing_, gaveta mobile com sombra
  `--shadow-lg` e _backdrop_ com blur.
- **Primitivos compartilhados novos:** `.empty-state` (lista vazia padronizada)
  e `.skeleton` global (antes só existia no Dashboard).
- **Correção de tema:** `.license-banner` usava hex fixo claro e ficava ilegível
  no tema escuro — agora sai dos tokens `--warning-*` / `--danger-*` /
  `--success-*` e funciona nos dois temas.
- **Correções da revisão de segurança** (aplicadas na mesma sessão — ver
  `.claude/seguranca/relatorios/2026-09-07-ui-ux-rodada-1.md`):
  - **SEC-061 (Alto):** `LoginPage.tsx` não embute mais `admin`/`admin`. Os
    campos nascem vazios; o usuário só é pré-preenchido quando
    `import.meta.env.DEV` **e** `VITE_DEV_USER` (novo, em `vite-env.d.ts`)
    existem; a senha nunca. Confirmado ausente do bundle de produção.
  - **SEC-062 (Baixo):** anel de foco com contraste >= 3:1 (`--ring` a alpha
    0.75/0.60) + fallback `@media (forced-colors: active)` com `outline`.
  - **SEC-063 (Baixo):** `.skeleton` sem `!important`; grid de indicadores com
    `aria-busy`/`aria-hidden` e status `.sr-only` (utilitário novo).
  - **SEC-064 (Baixo):** token `--accent` definido (alias de `--primary`) —
    `PromotionsModal`/`FinancePage` param de cair em hex fixo.
  - **SEC-065 (Baixo):** `--border` do tema claro revertido a 0.12; token
    `--border-field` (~3:1) para o contorno dos campos.
- **Telas de entrada:**
  - Login (`LoginPage.tsx` + `.css`): `autoComplete` correto
    (`username` / `current-password`), `autoFocus`, `<label htmlFor>` associado,
    erro com `role="alert"`, foco visível nos campos, cartão com entrada
    animada e espaçamento por escala.
  - Modal (`Modal.css`): `z-index` pelo token `--z-modal` (acima da gaveta),
    entrada animada de _backdrop_ e cartão, raios por token.
  - Dashboard (`DashboardPage.css`): barras com _hover_, alertas operacionais
    por token, _skeleton_ local removido em favor do global.
  - Relatórios (`ReportsPage.css`): foco visível nos campos de período.

---

## Rodada 2 — PDV e Caixa (fluxo de balcão) ⏳

Telas de maior tráfego e maior custo de erro. Foco em densidade, hierarquia do
_checkout_ e leitura rápida sob pressão.

- PDV: reforço visual do bloco Total → Desconto → Cliente → Pagamento →
  Finalizar; estados de foco/erro nos campos de pagamento; lista de resultados
  de busca com item selecionável por teclado bem marcado; carrinho com
  hierarquia mais clara entre item, quantidade e total de linha.
- Caixa: leitura X/Z com agrupamento visual, alerta de gaveta acima do teto
  usando `.empty-state`/tokens, consolidado multi-caixa responsivo revisado.
- `SaleReceipt`: revisão tipográfica do recibo e dos estados de compartilhar.
- Estados vazios e de carregamento (`.skeleton`) aplicados nas listas dessas
  telas.

## Rodada 3 — Catálogo e Clientes (telas de cadastro/tabela) 🔄

### Parcial — entregue em 2026-09-07 (Catálogo + Clientes)

- **Toolbar moderna compartilhada** (`styles.css`): `.toolbar-field` com ícone
  embutido como elemento próprio (herda `currentColor`, sem data-URI de cor
  fixa), `.is-filter` para selects, `.is-active` destacando filtro com valor
  escolhido no tom da marca. Botões de navegação `<a>` (`a.primary-button` /
  `a.ghost-button`) e utilitário `.with-icon`.
- **Ícones de interface** (`components/ui-icons.tsx`, novo): `IconSearch`,
  `IconCaret`, `IconCategory`, `IconBox`, `IconPlus`, `IconFilter`, `IconCake`
  — mesma linha dos ícones do menu (SVG inline, `currentColor`, `aria-hidden`).
- **Superfícies opacas no tema escuro** (`styles.css`): `--surface-2` deixou de
  ter alpha (`rgba(19,30,48,0.92)` → `#131e30`). Com transparência, o brilho
  radial do fundo vazava pelos 8% e o mesmo `.panel` mudava de tom conforme a
  posição na viewport — Produtos e Vendas (painel no topo) puxavam azul; as
  demais, não. Agora todo painel/cartão/modal tem a mesma cor em qualquer tela.
- **Produtos** (`ProductsPage.tsx`): busca com ícone; filtro de categoria
  reestilizado (select nativo com seta própria, contorno de marca quando
  ativo); botão **Estoque** movido do menu lateral para o cabeçalho da página
  (atalho `<a>` para `/estoque`, visível com `inventory.view`).
- **Menu lateral** (`Layout.tsx`): item "Estoque" removido do grupo Catálogo;
  correção do recolhimento de grupo — a escolha de recolher passa a ser sempre
  respeitada (antes, um grupo que continha a tela atual, como "Operação" para
  o operador de caixa, nunca recolhia); o item ativo continua visível mesmo
  com o grupo recolhido, para não se perder o lugar.
- **Categorias** e **Estoque** (`CategoriesPage.tsx`, `InventoryPage.tsx`):
  campo de busca no mesmo padrão de Produtos; `.empty-state`/linha de vazio
  com texto que distingue "sem cadastro" de "sem resultado da busca". Em
  Estoque, o interruptor "Só ruptura" desceu do cabeçalho para a toolbar.
- **Promoções** (`components/PromotionsModal.tsx` + `.css`,
  `pages/PromotionsPage.tsx`): master-detail substituído por **grade de cards**
  (resumo em linguagem natural, tags de tipo/alvo/prioridade/janela, pill
  ativa/inativa, ações Editar/Remover) + **formulário em modal** com
  espaçamento por escala e rodapé de ações consistente. CSS migrado para
  tokens (pills de estado saem de `--success-*`; fim dos hex/`rgba` de
  _fallback_). `PromotionsManager`/`PromotionsModal` mantêm a mesma interface,
  então Configurações continua funcionando.
- **Clientes** (`pages/CustomersPage.tsx` + `.css` novo): toolbar no padrão
  compartilhado (busca com ícone, filtro de segmento com funil + seta própria,
  `.is-active` quando há segmento). O botão "Aniversariantes" trocou o emoji
  pelo `IconCake` e ganhou `aria-pressed`.
- **Aniversariantes remodelado**: lista em `.list-rows` substituída por **grade
  de cards** — avatar com iniciais e cor estável por nome, dia em destaque
  (pílula), contexto ("Hoje 🎉 · faz 38", "em 4 dias", "há 3 dias"), e ações
  rápidas de contato (WhatsApp `wa.me`, `tel:`, `mailto:`). Navegação de mês
  vira controle único `‹ mês ›` com `<select>` centralizado; `.empty-state`
  padrão quando não há aniversário. O card do dia recebe `is-today` (borda e
  pílula no tom da marca).
- **Menu**: "Clientes" deixou de ser grupo solto e virou item do grupo
  **Catálogo** (`Layout.tsx`).

### Correções da revisão de segurança (aplicadas na mesma sessão)

- **SEC-103 (Médio):** `lib/download.ts:toCsv` passou a neutralizar prefixo de
  fórmula (`= + - @ TAB CR`) nos campos de texto, com exceção para valores
  numéricos (a coluna "Total gasto" continua somável no Excel) — mesma regra do
  `backend/src/reports/csv.ts`. O export de Clientes e o de Aniversariantes eram
  o único escritor de CSV do frontend sem essa proteção.
- **SEC-104 (Baixo):** `waLink()` local, que prefixava `55` a qualquer número
  de até 11 dígitos (inclusive fixo de 8), foi removido; o chip de WhatsApp usa
  o helper canônico `whatsappUrl()` de `lib/receipt-share.ts`, que só compõe
  destinatário para telefone brasileiro com DDD e cai para "sem destinatário"
  no resto.
- **SEC-101 (Baixo):** `avatarColor()` baixou a luminosidade de 42% para 30% —
  as iniciais brancas do avatar passam contraste AA em qualquer matiz.
- **SEC-102 (Baixo):** a pílula do dia no card `is-today` trocou
  `--primary`/`--on-primary` (2.6:1 no escuro) por `--accent-soft` +
  `--text-strong`.
- **SEC-100 (Baixo):** o link "em ruptura" do Dashboard (`DashboardPage.tsx`)
  passou a checar `inventory.view` — sem a permissão vira texto, não um link
  que responderia 403.

### Pendente

- Tabela de dados: cabeçalho _sticky_ opcional, densidade e zebra revisadas,
  ações de linha com alvo de toque adequado.
- Modais de formulário (Cliente, Importação, Usuários/Permissões): foco preso
  no modal (_focus trap_) além do retorno de foco que já existe (ver SEC-068).

## Rodada 3.5 — Foto do produto ✅

Entregue em 2026-09-08. É a primeira entrega desta revitalização que muda o
**modelo de dados**, e não só a apresentação: sem foto, a identificação do item
no balcão dependia de ler o nome inteiro, que é justamente o que não acontece
sob pressão de fila.

### Decisões de design

- **Quadrado 1:1, sempre.** Não é limitação técnica: numa grade em que cada
  item tem proporção diferente, o olho precisa reprocessar cada célula. Com o
  quadrado fixo, lista, grade e PDV ganham o mesmo ritmo, e o operador reconhece
  o item pela forma e pela cor antes de ler o nome.
- **Reserva desenhada, nunca buraco.** Produto sem foto mostra as iniciais sobre
  uma cor derivada do nome (mesma função de matiz dos aniversariantes, com
  luminosidade 30% para contraste AA). A caixa tem o mesmo tamanho da foto, então
  a lista não muda de altura conforme o catálogo vai sendo fotografado — e não há
  salto de layout enquanto as imagens carregam.
- **Recorte no navegador, WYSIWYG.** A mesma função (`lib/image.ts:drawSquare`)
  desenha a prévia e o arquivo final, então o enquadramento que a pessoa viu é
  exatamente o que fica salvo. O editor tem arrastar para enquadrar, zoom (roda
  do mouse, controle deslizante e `+`/`-` no teclado), girar 90° e guias de
  terços.
- **Quatro caminhos de entrada**, na ordem em que aparecem no balcão: arrastar o
  arquivo, colar com `Ctrl+V` (foto que veio do fornecedor por conversa),
  escolher arquivo e fotografar (o botão de câmera só aparece em toque, com
  `capture="environment"`).
- **Rascunho até salvar.** A foto só sobe quando o produto é salvo — "Cancelar"
  cancela a foto junto, como se espera de um formulário. Se o produto salvar e a
  foto falhar, o erro vira aviso no lugar de derrubar o formulário: o produto já
  existe, e uma segunda tentativa esbarraria em "SKU já existe".
- **Grade como lista de tarefas de catalogação.** No modo grade, o cartão sem
  foto mostra o convite "+ foto" e a própria imagem é o alvo de clique — com o
  catálogo em grade, "está sem foto" e "quero trocar a foto" são a mesma
  intenção, e ela nasce olhando para a imagem.

### Onde a foto aparece

- **Produtos** (`ProductsPage.tsx` + `.css` novo): coluna de miniatura na
  tabela, alternador Lista/Grade na toolbar (`.view-switch`, preferência
  guardada no navegador) e grade de cartões com foto, preço, saldo e ações.
- **PDV** (`PdvPage.tsx`): miniatura no resultado da busca e em cada linha do
  carrinho — é onde o erro custa mais caro (item trocado sai pela porta).
- **Estoque** (`InventoryPage.tsx`): miniatura na linha; a conferência é feita
  com o produto na mão.

### Peças novas

- `lib/image.ts` — leitura, giro, recorte quadrado e recompressão em WebP (com
  JPEG de reserva onde o navegador não codifica WebP), com queda de qualidade em
  degraus até caber no limite do servidor. Sobe ~60 KB no lugar dos 5 MB do
  arquivo original.
- `components/ProductThumb.tsx` + `.css` — miniatura com `loading="lazy"`,
  reserva de iniciais e a coluna `.cell-thumb` para tabelas.
- `components/ProductPhotoField.tsx` + `.css` — área de soltar/colar, prévia e
  editor de recorte.
- `components/ui-icons.tsx` — `IconCamera`, `IconUpload`, `IconRotate`,
  `IconZoom`, `IconTrash`, `IconGrid`, `IconList`.
- Backend: modelo `ProductImage` (tabela separada, para `GET /products` não
  trafegar bytes), rotas `PUT`/`DELETE /products/:id/image` sob
  `products.manage` e a rota pública `GET /product-images/:token[/thumb]` com
  cache imutável.

### Correção de apoio

- `Modal.tsx`: o foco inicial passa a procurar o primeiro controle **visível**.
  A busca crua pegava também os campos de arquivo escondidos do seletor de foto,
  e o foco morreria num elemento fora da tela.

## Rodada 4 — Análise, Configurações e polimento final ⏳

- Financeiro e Relatórios: linguagem visual única de gráficos de barras e de
  participação; legendas e eixos legíveis nos dois temas.
- Configurações: _cards_ de logo e linhas de dados no padrão de painel;
  pré-visualização de logo sem hex fixo.
- Varredura final: contraste AA em todos os pares texto/fundo, ordem de
  tabulação, `aria-*` em controles compostos, remoção de qualquer px/hex solto
  remanescente, checagem em telas estreitas.

---

## Verificação por rodada

| Rodada | Build | Typecheck | `revisor-seguranca` |
| ------ | ----- | --------- | ------------------- |
| 1      | ✅    | ✅        | ✅ COMMITAR COM RESSALVAS — 1 Alto pré-existente (SEC-061) e 3 regressões Baixas corrigidas na mesma sessão; relatório em `.claude/seguranca/relatorios/2026-09-07-ui-ux-rodada-1.md` |
| 2      | —     | —         | —                  |
| 3 (parcial) | ✅ `npm run build -w frontend` | ✅ `tsc -b` | pendente — rodar sobre o diff da sessão |
| 3.5 (foto do produto) | ✅ `npm run build -w frontend` + `-w backend` | ✅ `tsc -b` + `tsc -p backend/tsconfig.build.json` | ✅ COMMITAR COM RESSALVAS — 1 Alto pré-existente e ampliado (SEC-099, trilha de auditoria em `products/`) segue **em aberto**; 1 Médio e 4 Baixos corrigidos na mesma sessão. Relatório em `.claude/seguranca/relatorios/2026-09-08-fotos-de-produto.md` |
| 4      | —     | —         | —                  |
