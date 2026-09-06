# Como usar o `revisor-seguranca` de verdade

Contexto: commit direto em branch de trabalho (`Dev`), sem PR obrigatório, e um
CI que só faz `npm ci`, `prisma generate` e os dois builds — **não roda testes,
lint nem `npm audit`**. Isso significa que não existe um portão automático entre
o código e a loja em produção. O portão precisa ser criado por hábito e por
ferramenta local. O que segue é o mínimo para que o agente seja usado e não vire
enfeite.

---

## 1. Onde as peças moram

```
.claude/
  agents/
    revisor-seguranca.md          ← o agente (único arquivo com frontmatter: é o
                                    que o Claude Code registra como subagente)
    baseline.md                   ← estado conhecido, riscos aceitos, achados abertos
    guia-de-uso.md                ← este arquivo
  commands/
    seg.md                        ← atalho /seg
  hooks/
    marca-inicio-de-sessao.sh     ← SessionStart: grava o HEAD do início da sessão
    revisao-fim-de-sessao.sh      ← Stop: portão de saída (cobra a revisão)
    check-backend-stale.sh        ← PostToolUse: avisa se o backend no ar está velho
  seguranca/
    estado/                       ← marcas de sessão e da última revisão (gitignored)
    relatorios/                   ← histórico, um arquivo por revisão
  settings.json                   ← registra os três hooks
```

`baseline.md` e `guia-de-uso.md` estão em `agents/` por conveniência, mas **não
são agentes**: não têm frontmatter, então o Claude Code os ignora ao montar a
lista de subagentes. Só `revisor-seguranca.md` é registrado.

Mantenha o `baseline.md` vivo. Sem ele o agente relata as mesmas coisas
conhecidas em toda execução, você começa a ignorar o relatório, e aí o agente
deixou de servir.

---

## 2. Os quatro momentos de uso

### a) Fim de sessão — automático, e o mais importante
Regra do projeto: **nenhuma sessão termina sem passar pelo revisor.** O hook
`Stop` (`revisao-fim-de-sessao.sh`) segura o encerramento e manda o Claude rodar
o subagente sobre o diff da sessão.

Como o hook decide:

- escopo = tudo que mudou desde o HEAD marcado no `SessionStart`, commitado ou
  não; sem a marca, cai para a comparação com a `main`;
- nada alterado → não cobra;
- conjunto de mudanças idêntico a um já cobrado → não cobra de novo (o estado
  fica em `.claude/seguranca/estado/ultima-revisao`);
- caso contrário → sai com código 2, o Claude não encerra e recebe a ordem;
- na segunda parada (`stop_hook_active: true`) ele libera, para não entrar em
  laço.

O hook nunca derruba a sessão: qualquer erro ou indeterminação vira saída
silenciosa. Ele é um lembrete com dentes, não uma trava.

### b) Antes de commitar em caminho sensível — manual
Chame `/seg` quando o `git status` tocar em qualquer um destes (a lista completa
está no §7 do agente):

```
backend/src/access/**            backend/src/auth/**
backend/src/common/*.guard.ts    backend/src/common/grant.decorator.ts
backend/src/sales/**             backend/src/cash/**
backend/src/fiscal/**            backend/src/settings/**
backend/src/store-settings/**    backend/src/users/**
backend/src/main.ts              backend/prisma/schema.prisma
frontend/src/lib/api-client.ts   frontend/src/store/authStore.ts
package.json  package-lock.json  .github/workflows/**
```

Escopo: só o diff. Leva poucos minutos, porque os builds só rodam se o diff tocar
código compilado. Veredito **BLOQUEAR** significa: não commite, ou commite numa
branch e corrija antes de mesclar.

### c) Varredura completa semanal
Uma vez por semana, escopo total, sem diff. É o que pega o que foi entrando aos
poucos e o que envelheceu (dependência com CVE novo, risco aceito cujo prazo
venceu). Salve o relatório em `.claude/seguranca/relatorios/`.

### d) Antes de subir versão para uma loja real
Varredura completa + builds + `npm audit` + o e2e de checkout,
obrigatoriamente. Aqui dinheiro e nota fiscal de terceiros passam a depender do
código.

---

## 3. O atalho `/seg`

Já instalado em `.claude/commands/seg.md`. Uso:

- `/seg` — revisa o diff atual;
- `/seg módulo de caixa` — revisa só o que você nomear;
- `/seg varredura completa` — base inteira.

---

## 4. O que é automático hoje

| Hook | Evento | O que faz |
|---|---|---|
| `marca-inicio-de-sessao.sh` | `SessionStart` | grava o HEAD em `.claude/seguranca/estado/sessao-<id>` para o portão saber o que é "o diff desta sessão" |
| `revisao-fim-de-sessao.sh` | `Stop` | cobra a revisão de segurança antes de encerrar |
| `check-backend-stale.sh` | `PostToolUse` (Write\|Edit) | avisa quando o backend no ar está rodando um `dist/` mais velho que o `src/` |

Os três estão registrados em `.claude/settings.json`. Se a API de hooks mudar em
uma versão futura do Claude Code, um hook quebrado falha **silenciosamente** —
confira com `/hooks` de vez em quando. Hook que não dispara é pior que hook
nenhum, porque você acha que está protegido.

Complemento fora do Claude, e o mais valioso: um `pre-commit` do git rodando
`gitleaks protect --staged` bloqueia segredo commitado de forma determinística,
o que nenhum LLM garante.

---

## 5. O loop de correção (a parte que costuma ser pulada)

O agente não edita. O ciclo completo é:

1. `/seg` (ou o portão de saída) → relatório com veredito.
2. Você, ou a sessão principal do Claude, aplica as correções **começando pelas
   Críticas**, uma de cada vez.
3. Para cada achado Crítico ou Alto, escreva o **teste de regressão** que o
   agente sugeriu. Este é o passo de maior retorno de todo o processo: o agente
   encontra o buraco uma vez; o teste impede que ele volte para sempre. Neste
   projeto o lugar natural é `backend/test/` — um caso por rota sensível
   verificando `403` para quem não tem a permissão, e um caso confirmando que o
   vale de supervisor não é reutilizável.
4. `/seg` de novo, no mesmo escopo, para confirmar. O agente deve reconhecer os
   IDs corrigidos.
5. Atualize `baseline.md`: mova o achado para "Corrigidos", com commit e caminho
   do teste; ou, se for aceitar o risco, escreva o bloco de risco aceito **com
   data de revisão**.

Sem o passo 5 o baseline apodrece e o passo 1 vira ruído em duas semanas.

---

## 6. O que o agente não substitui

Um LLM é bom em ler intenção e contexto — "esta rota deveria exigir
`sales.cancel`" — e ruim em garantia determinística. Combine com ferramentas que
não erram:

| Ferramenta | Cobre o que o agente não garante |
|---|---|
| `gitleaks` / `trufflehog` (pre-commit + histórico) | segredo commitado, sem depender de o agente ter olhado o arquivo certo |
| `semgrep` (regras nestjs, react, typescript) | padrões de injeção e config insegura, em toda execução, sem variar |
| `npm audit` no CI + Dependabot | CVE novo em dependência, sem alguém lembrar de rodar |
| `eslint-plugin-security` | armadilhas de JS no editor |
| Testes e2e de autorização | a regressão que o agente encontrou hoje e não veria de novo amanhã |

Três destes cinco ainda não existem aqui. O item mais barato e de maior retorno é
acrescentar `npm audit --omit=dev` e `npm run test:e2e -w backend` ao
`.github/workflows/ci.yml` — está registrado como SEC-007 no baseline.

O agente é a camada de julgamento em cima dessas; não o contrário.

---

## 7. Sinais de que está funcionando

- O número de achados **novos** por varredura completa cai ao longo das semanas.
- A seção "Verificado OK" do baseline cresce.
- Nenhum achado Crítico/Alto sai do baseline sem teste apontado.
- Você lê o relatório inteiro. No dia em que começar a passar o olho e commitar
  assim mesmo, o problema não é o código — é o relatório estar longo demais.
  Aperte a rubrica de severidade e o limite de 12 achados.
- O portão de saída passa a sair "LIBERADO" na maioria das sessões. Se ele
  bloqueia toda vez, ou a rubrica está frouxa ou o hábito de corrigir na hora se
  perdeu.
