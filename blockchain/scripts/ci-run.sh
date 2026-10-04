#!/usr/bin/env bash
# Corre un comando en GitHub Actions y, si falla, deja el final del error como aviso visible en la
# corrida (sin eso, el motivo solo se ve entrando al log del job).
#
# Uso: bash scripts/ci-run.sh "Título del aviso" comando [argumentos...]
set -uo pipefail

title=$1
shift
log=$(mktemp)
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
# Si el comando ya dejó su propio aviso de error (como el control de saldo), no se repite.
if [ "$status" -ne 0 ] && ! grep -q '^::error' "$log"; then
  # Las últimas líneas con texto, sin la pila de llamadas, la descarga del compilador ni otros
  # comandos de Actions.
  message=$(grep -Ev '^[[:space:]]+at |^::|^[[:space:]]*$|^Downloading solc|^Compiled [0-9]+ Solidity|^Nothing to compile' "$log" | tail -n 8 | tr '\n' ' ' | tr -s ' ' | cut -c1-1000)
  message=${message//%/%25}
  echo "::error title=${title}::${message:-El comando terminó con código ${status}.}"
fi
rm -f "$log"
exit "$status"
