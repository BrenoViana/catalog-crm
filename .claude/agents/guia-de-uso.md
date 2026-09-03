# Como usar o `revisor-seguranca` de verdade

Contexto: commit direto na `main`, sem PR e sem CI. Isso significa que **não
existe um portão natural** entre o código e a produção — o portão precisa ser
criado por hábito e por ferramenta local. O agente sozinho não cria hábito;
o que segue é o mínimo para que ele seja usado e não vire enfeite.

---

## 1. Instalação

```
.claude/
  agents/
    revisor-seguranca.md        ← o agente revisado
  commands/
    seg.md                      ← atalho /seg (abaixo)
docs/
  seguranca/
    baseline.md                 ← estado conhecido e riscos aceitos
    relatorios/                 ← histórico, um arquivo por revisão
```

Preencha o `baseline.md` **antes da primeira rodada**. Sem ele o agente vai
relatar as mesmas coisas conhecidas em toda execução, você vai começar a
ignorar o relatório, e aí o agente deixou de servir.

---

## 2. Os três momentos de uso

Frequência demais cansa; de menos não protege. Três gatilhos:

### a) Antes de commitar em caminho sensível — o principal
Chame o agente quando o `git status` tocar em qualquer um destes:

```
auth/  users/  sale*  payment*  cash*  fiscal*  store-settings*
*.guard.ts  *.strategy.ts  *.dto.ts  main.ts  schema.prisma
package.json  package-lock.json  Dockerfile  .github/workflows/
```

Escopo: só o diff. Deve levar poucos minutos, porque os builds só rodam se o
diff tocar código compilado. Veredito **BLOQUEAR** significa: não commite, ou
commite numa branch e corrija antes de mesclar.

### b) Varredura completa semanal
Uma vez por semana, escopo total, sem diff. É o que pega o que foi entrando aos
poucos e o que envelheceu (dependência com CVE novo, segredo que virou
produção). Salve o relatório em `docs/seguranca/relatorios/`.

### c) Antes de subir versão para uma loja real
Varredura completa + builds + audit, obrigatoriamente. Aqui dinheiro e nota
fiscal de terceiros passam a depender do código.

---

## 3. O atalho `/seg`

`.claude/commands/seg.md`:

```markdown
---
description: Revisão de segurança do diff atual (ou do escopo informado)
---

Use o subagente `revisor-seguranca`.

Escopo: $ARGUMENTS
Se $ARGUMENTS estiver vazio, revise o diff atual (working tree + staged +
branch à frente da main).

Leia `docs/seguranca/baseline.md` antes de começar e siga integralmente o
formato de relatório do agente, incluindo o veredito na primeira linha.
```

Uso: `/seg`, `/seg módulo de caixa`, `/seg varredura completa`.

---

## 4. Lembrete automático antes do commit

Como não há CI, o único ponto automático é local. Um hook `PreToolUse` em
`.claude/settings.json` que **avisa** (não bloqueia) quando um `git commit`
toca caminho sensível:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/lembrete-seguranca.sh"
          }
        ]
      }
    ]
  }
}
```

`.claude/hooks/lembrete-seguranca.sh` — lê o JSON do hook no stdin, e se o
comando for um `git commit` com arquivos sensíveis no stage, imprime o aviso:

```bash
#!/usr/bin/env bash
cmd=$(cat | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
sens=$(git diff --cached --name-only | grep -Ei 'auth|user|sale|payment|cash|fiscal|store-settings|\.guard\.ts|\.dto\.ts|main\.ts|schema\.prisma|package(-lock)?\.json|Dockerfile|\.github/workflows')
[ -n "$sens" ] && echo "⚠️  Caminho sensível no stage. Rode /seg antes de commitar:
$sens"
exit 0
```

Verifique o formato de hook da sua versão do Claude Code antes de confiar nele —
a API de hooks muda. Um hook que falha silenciosamente é pior que nenhum.

Complemento fora do Claude: `pre-commit` do git rodando `gitleaks protect
--staged` bloqueia segredo commitado de forma determinística, o que nenhum LLM
garante.

---

## 5. O loop de correção (a parte que costuma ser pulada)

O agente não edita. O ciclo completo é:

1. `/seg` → relatório com veredito.
2. Você (ou a sessão principal do Claude) aplica as correções, **começando pelas
   Críticas**, uma de cada vez.
3. Para cada achado Crítico ou Alto, escreva o **teste de regressão** que o
   agente sugeriu. Este é o passo de maior retorno de todo o processo: o agente
   encontra o buraco uma vez; o teste impede que ele volte para sempre. Em
   NestJS, um `supertest` e2e por rota sensível verificando `403` para papel
   errado vale mais que dez revisões.
4. `/seg` de novo, no mesmo escopo, para confirmar. O agente deve reconhecer os
   IDs corrigidos.
5. Atualize `baseline.md`: mova o achado para "Corrigidos", com commit e caminho
   do teste.

Sem o passo 5 o baseline apodrece e o passo 1 vira ruído em duas semanas.

---

## 6. O que o agente não substitui

Um LLM é bom em ler intenção e contexto — "esta rota deveria exigir gerente" — e
ruim em garantia determinística. Combine com ferramentas que não erram:

| Ferramenta | Cobre o que o agente não garante |
|---|---|
| `gitleaks` / `trufflehog` (pre-commit + histórico) | segredo commitado, sem depender de o agente ter olhado o arquivo certo |
| `semgrep` (regras nestjs, react, typescript) | padrões de injeção e config insegura, em toda execução, sem variar |
| `npm audit` + Renovate/Dependabot | CVE novo em dependência, sem alguém lembrar de rodar |
| `eslint-plugin-security` | armadilhas de JS no editor |
| Testes e2e de autorização | a regressão que o agente encontrou hoje e não veria de novo amanhã |

O agente é a camada de julgamento em cima dessas; não o contrário.

---

## 7. Sinais de que está funcionando

- O número de achados **novos** por varredura completa cai ao longo das semanas.
- A seção "Verificado OK" cresce.
- Nenhum achado Crítico/Alto sai do baseline sem teste apontado.
- Você lê o relatório inteiro. No dia em que começar a passar o olho e commitar
  assim mesmo, o problema não é o código — é o relatório estar longo demais.
  Aperte a rubrica de severidade e o limite de 12 achados.
