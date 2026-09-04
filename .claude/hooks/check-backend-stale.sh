#!/usr/bin/env bash
# PostToolUse guard: avisa quando o backend em execucao (porta da API) esta
# rodando um build (dist/) mais antigo que backend/src — sintoma de servidor
# iniciado com `node dist/main.js` em vez de `npm run backend:dev` (watch).
#
# Sob watch, o nest recompila e atualiza dist/ em segundos, entao a folga de
# GRACE_SECONDS evita falso-positivo logo apos uma edicao. Sob build estatico,
# dist/ nunca alcanca o src e o aviso persiste.
#
# Nunca falha a operacao: qualquer erro/indeterminacao -> exit 0 silencioso.
# So emite exit 2 (que volta para o Claude) quando ha certeza da defasagem.

set -u
GRACE_SECONDS=25

# Le o payload do hook (JSON no stdin).
payload="$(cat 2>/dev/null || true)"

# Extrai o caminho do arquivo editado (jq se houver; senao, fallback textual).
if command -v jq >/dev/null 2>&1; then
  fp="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
else
  fp="$(printf '%s' "$payload" | tr ',' '\n' \
        | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)"
fi
[ -n "${fp:-}" ] || exit 0

# Normaliza barras (o JSON no Windows traz caminhos com \\).
fp_norm="$(printf '%s' "$fp" | tr '\\' '/')"
case "$fp_norm" in
  */backend/src/*|*/backend/prisma/*) ;;
  *) exit 0 ;;
esac

# Opera a partir da raiz do repo.
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] && cd "$root" 2>/dev/null || exit 0
[ -d backend/src ] || exit 0

# Artefato de build do nest.
dist="backend/dist/main.js"
[ -f "$dist" ] || dist="backend/dist/src/main.js"
[ -f "$dist" ] || exit 0   # sem build -> nada com que comparar

# Porta da API (PORT do .env, senao 3000).
api_port="$(sed -n 's/^PORT=\([0-9]\{1,5\}\).*/\1/p' backend/.env 2>/dev/null | head -1)"
api_port="${api_port:-3000}"

port_listening() {
  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -Eq "[.:]${api_port}[[:space:]].*(LISTEN|LISTENING)" && return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -Eq "[.:]${api_port}[[:space:]]" && return 0
  fi
  (exec 3<>"/dev/tcp/127.0.0.1/${api_port}") 2>/dev/null && { exec 3>&- 3<&-; return 0; }
  return 1
}
port_listening || exit 0   # servidor nao esta no ar -> nada a avisar

dist_mtime="$(stat -c %Y "$dist" 2>/dev/null || true)"
[ -n "$dist_mtime" ] || exit 0

newest_src="$(find backend/src backend/prisma -type f \( -name '*.ts' -o -name '*.prisma' \) \
              -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)"
[ -n "$newest_src" ] || exit 0

if [ "$newest_src" -gt "$((dist_mtime + GRACE_SECONDS))" ]; then
  ago_min=$(( (newest_src - dist_mtime) / 60 ))
  {
    echo "AVISO: o backend em execucao na porta ${api_port} esta desatualizado."
    echo "backend/src esta ~${ago_min} min mais novo que ${dist} (o build que o servidor carregou)."
    echo "Se NAO estiver rodando 'npm run backend:dev' (watch), as mudancas nao vao surtir efeito:"
    echo "  (cd backend && npm run build) e reinicie o servidor."
    echo "Ignore se voce acabou de editar e o watch ainda esta recompilando."
  } >&2
  exit 2
fi
exit 0
