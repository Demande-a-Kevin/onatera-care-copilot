#!/usr/bin/env bash
#
# Care Copilot - lanceur local.
# Demarre Ollama avec le bon OLLAMA_ORIGINS, sert le dossier en statique,
# et ouvre le navigateur. Aucune donnee ne quitte la machine.
#
set -euo pipefail

PORT="${PORT:-8080}"
ORIGIN="http://localhost:${PORT}"
MODEL="${OLLAMA_MODEL:-qwen2.5:7b-instruct}"
HERE="$(cd "$(dirname "$0")" && pwd)"

say(){ printf "\033[0;32m[care-copilot]\033[0m %s\n" "$1"; }
warn(){ printf "\033[0;33m[care-copilot]\033[0m %s\n" "$1"; }

# --- 1. Ollama installe ? -------------------------------------------------
if ! command -v ollama >/dev/null 2>&1; then
  warn "Ollama n'est pas installe (https://ollama.com)."
  warn "L'app fonctionnera quand meme en MODE DEMO (resultats pre-calcules)."
else
  # --- 2. Piege CORS : un Ollama tourne peut-etre SANS le bon OLLAMA_ORIGINS.
  # On ne peut pas lire les origins d'un process deja lance ; le plus fiable
  # est de le tuer et de le relancer avec la bonne variable.
  if pgrep -x ollama >/dev/null 2>&1 || curl -s -o /dev/null "http://localhost:11434/api/tags"; then
    warn "Un Ollama tourne deja - je le relance avec OLLAMA_ORIGINS=${ORIGIN} (necessaire pour le navigateur)."
    pkill -x ollama 2>/dev/null || true
    # 'ollama serve' et l'app de bureau peuvent tourner sous des noms differents
    pkill -f "ollama serve" 2>/dev/null || true
    sleep 1
  fi

  say "Demarrage d'Ollama (OLLAMA_ORIGINS=${ORIGIN})..."
  OLLAMA_ORIGINS="${ORIGIN}" ollama serve >/tmp/ollama-care.log 2>&1 &
  OLLAMA_PID=$!

  # attendre qu'il reponde
  for i in $(seq 1 20); do
    if curl -s -o /dev/null "http://localhost:11434/api/tags"; then break; fi
    sleep 0.5
  done

  # modele present ?
  if curl -s "http://localhost:11434/api/tags" | grep -q "${MODEL%%:*}"; then
    say "Modele disponible."
  else
    warn "Modele ${MODEL} absent. Pour le mode live : ollama pull ${MODEL}"
    warn "En attendant, l'app basculera automatiquement en mode demo."
  fi
fi

# --- 3. Serveur statique --------------------------------------------------
say "Serveur statique sur ${ORIGIN}"
say "Ouvrez ${ORIGIN} (ne PAS ouvrir index.html en file:// - CORS echouera)."

# ouvrir le navigateur (macOS / Linux)
( sleep 1
  if command -v open >/dev/null 2>&1; then open "${ORIGIN}";
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "${ORIGIN}"; fi
) >/dev/null 2>&1 &

cd "${HERE}"
# Ctrl+C arrete proprement le serveur ; Ollama continue (relancable).
python3 -m http.server "${PORT}"
