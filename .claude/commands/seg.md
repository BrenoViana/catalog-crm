---
description: Revisão de segurança do diff atual (ou do escopo informado)
---

Use o subagente `revisor-seguranca`.

Escopo: $ARGUMENTS

Se `$ARGUMENTS` estiver vazio, revise o diff atual: working tree + staged +
commits à frente da `main`. Se houver uma marca de início de sessão em
`.claude/seguranca/estado/`, use o SHA de lá como base do diff.

O agente deve ler `.claude/agents/baseline.md` antes de começar e seguir
integralmente o formato de relatório definido no próprio agente, incluindo o
veredito na primeira linha.

Ao receber o relatório, repasse ao usuário o veredito e os achados Críticos e
Altos na íntegra; não resuma achado bloqueante.
