#!/usr/bin/env bash
# SessionStart hook: grava o HEAD do inicio da sessao.
#
# Serve so para o portao de saida (revisao-fim-de-sessao.sh) saber o que "o
# diff desta sessao" significa: tudo que mudou de la para ca, commitado ou nao.
# Sem esta marca o portao cai para a comparacao com a main, que e mais larga.
#
# Nunca falha a sessao: qualquer erro -> exit 0 silencioso.

set -u

payload="$(cat 2>/dev/null || true)"

if command -v jq >/dev/null 2>&1; then
  sid="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
else
  sid="$(printf '%s' "$payload" | tr ',' '\n' \
        | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi
[ -n "${sid:-}" ] || exit 0
# O id vira componente de caminho: recusa qualquer coisa fora de [A-Za-z0-9-]
# (um valor com "../" escreveria fora de .claude/seguranca/estado/).
case "$sid" in *[!A-Za-z0-9-]*) exit 0 ;; esac

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] || exit 0
cd "$root" 2>/dev/null || exit 0

head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
[ -n "$head_sha" ] || exit 0

estado=".claude/seguranca/estado"
mkdir -p "$estado" 2>/dev/null || exit 0

# Uma sessao retomada (--continue/--resume) reabre com o mesmo id: nao
# sobrescreve a marca original, senao o que ja foi feito sairia do escopo.
[ -f "$estado/sessao-$sid" ] && exit 0

printf '%s\n' "$head_sha" > "$estado/sessao-$sid" 2>/dev/null

# Higiene: guarda no maximo as 50 marcas mais recentes.
ls -1t "$estado"/sessao-* 2>/dev/null | tail -n +51 | while IFS= read -r velho; do
  rm -f "$velho" 2>/dev/null
done

exit 0
