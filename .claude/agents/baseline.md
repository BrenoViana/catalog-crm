# Baseline de segurança — catalog-crm

Arquivo vivo. O agente `revisor-seguranca` lê este arquivo antes de cada revisão
e propõe atualizações no fim do relatório. **Você** aplica as atualizações — o
agente não escreve arquivos.

Regras:

- Nada aqui é permanente. Todo risco aceito tem **data de revisão**; passou da
  data, volta a ser achado.
- Se o código divergir do que está escrito aqui, a divergência é achado.
- IDs `SEC-###` são estáveis e nunca reutilizados.

Última atualização: `AAAA-MM-DD` — por: `<nome>` — revisão de referência: `<commit>`

---

## 1. Superfície e decisões de arquitetura

| Item | Estado atual | Observação |
|---|---|---|
| Autenticação | JWT HS256, segredo por env | sem refresh token, sem revogação de servidor |
| Autorização | `JwtAuthGuard` (só autentica) | papéis: `ADMIN`, `GERENTE`, `OPERADOR` |
| Token no cliente | `localStorage` | aceito enquanto não houver XSS conhecido — ver SEC-00X |
| Multi-loja | `<sim / não / previsto>` | se sim, toda query precisa filtrar `storeId` |
| Provedor fiscal | `<nome>` | URL configurável? se sim, exige allowlist (SSRF) |
| Certificado A1 | `<armazenado onde>` | senha do PFX: `<como é guardada>` |
| Upload de imagem | `<destino>` | limites e validação: `<descrever>` |
| Modo offline do PDV | `<sim / não>` | se sim, sincronização precisa de idempotência |
| Trilha de auditoria | `<existe? em que tabela?>` | operações cobertas: `<listar>` |
| CORS em produção | `<allowlist / origin: true>` | |
| `helmet` / CSP | `<sim / não>` | |
| Rate limit no login | `<sim / não>` | |

---

## 2. Riscos aceitos (com prazo)

Formato: um bloco por risco. Sem "data de revisão", o item não é aceito — é
apenas ignorado, e isso não conta.

### SEC-001 — Vulnerabilidades `high` transitivas do `prisma@7`
- **O que é**: `deepmerge-ts` (via `@prisma/config`) e `mysql2` aparecem no
  `npm audit` como `high`.
- **Por que é aceito**: são transitivas, o projeto usa apenas PostgreSQL e o
  código nunca alcança esses caminhos em runtime. `npm audit fix --force`
  regride a versão do Prisma e quebra o build.
- **Condição de reabertura**: qualquer uma virar dependência direta, passar a
  ser alcançável em runtime, mudar de contagem/severidade, ou o Prisma publicar
  correção.
- **Aceito em**: `AAAA-MM-DD` — por: `<nome>`
- **Revisar até**: `AAAA-MM-DD` (sugestão: 90 dias)

### SEC-00X — `<título>`
- **O que é**:
- **Por que é aceito**:
- **Condição de reabertura**:
- **Aceito em**: — por:
- **Revisar até**:

---

## 3. Achados abertos (não corrigidos, não aceitos)

| ID | Severidade | Título | Local | Aberto em | Dono | Situação |
|---|---|---|---|---|---|---|
| SEC-0XX | Alto | | `arquivo:linha` | AAAA-MM-DD | | em aberto |

---

## 4. Corrigidos (histórico curto)

| ID | Título | Corrigido em | Commit | Teste de regressão |
|---|---|---|---|---|
| SEC-0XX | | AAAA-MM-DD | `abc1234` | `<caminho do teste>` |

Regra: todo achado **Crítico** ou **Alto** só sai daqui com um teste automatizado
apontado na última coluna. Sem teste, ele volta.

---

## 5. Verificado OK recorrente

Pontos sensíveis que já foram conferidos e estão corretos. O revisor confirma em
uma linha em vez de reinvestigar do zero — mas reinvestiga se o arquivo mudou.

- `store-settings.service.ts` — token fiscal e CSC omitidos nas respostas de leitura
- `schema.prisma` — valores monetários em `Decimal`
- venda + estoque + caixa + documento fiscal na mesma transação
- `ValidationPipe` global com `whitelist` + `forbidNonWhitelisted` + `transform`
- `<adicionar conforme confirmado>`

---

## 6. Fora de escopo do revisor

Coisas que o agente não cobre e que precisam de outro controle:

- Segurança de infraestrutura e rede (firewall, TLS, backup do banco)
- Segurança física do terminal de PDV
- Revisão do provedor fiscal terceirizado
- `<outros>`
