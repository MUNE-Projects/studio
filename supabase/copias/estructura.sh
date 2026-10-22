#!/usr/bin/env bash
# Aplica la estructura de MUNE (supabase/0NN_*.sql, en orden) a un Supabase vacío,
# como se hace en el SQL Editor. 001 y 003 necesitan que ya exista la
# administradora y el robot: se crean dos usuarios provisionales, que
# restaurar.mjs --forzar sustituye por los de la copia.
# Uso, desde supabase/: bash copias/estructura.sh   (variables DB_URL, API_URL, SERVICE_ROLE_KEY)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DB_URL:?}" "${API_URL:?}" "${SERVICE_ROLE_KEY:?}"
case "$DB_URL$API_URL" in *iowtdenlkxjqzlpwizgb*) echo "Ese es el proyecto real de MUNE: aquí no se toca nada." >&2; exit 2 ;; esac

usuario() {
	curl -sS -f -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		-H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$(openssl rand -hex 16)\",\"email_confirm\":true}" >/dev/null
}
aplicar() { PGOPTIONS='-c client_min_messages=warning' psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

usuario provisional-admin@mune.invalid
aplicar 001_panel.sql
aplicar 002_promociones.sql
usuario provisional-robot@mune.invalid
aplicar 003_peticiones.sql
for f in 0*.sql; do [[ "$f" > 003 ]] && aplicar "$f"; done
echo "Estructura aplicada: $(ls 0*.sql | wc -l) archivos."
