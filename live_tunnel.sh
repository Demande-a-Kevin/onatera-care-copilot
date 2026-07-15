#!/usr/bin/env bash
#
# Active le MODE LIVE securise pour la demo en ligne.
# ---------------------------------------------------
# A lancer sur la machine du presentateur quand tu veux ouvrir une fenetre live.
# Ton tunnel prod "cockpit-tools" tourne deja et route
# ollama-copilot.kev1ncockpit.com -> http://localhost:11435 (le proxy ci-dessous).
# Ce script se contente donc de : (re)demarrer Ollama en LOCAL + lancer le proxy
# d'origine (qui exige ORIGIN_SECRET). Il NE relance PAS de tunnel.
#
#   navigateur --(DEMO_TOKEN)--> Worker onatera-copilot-live
#              --(ORIGIN_SECRET)--> tunnel prod --> proxy 11435 --> Ollama 11434
#
# Prerequis :
#   - live-bridge/.secret contient ORIGIN_SECRET=<meme valeur que le Worker>
#   - l'ingress ollama-copilot.kev1ncockpit.com pointe sur http://localhost:11435
#     (deja configure).
#
# A partager : https://onatera-copilot.pages.dev (le testeur clique "Mode live"
# et saisit le DEMO_TOKEN). Ctrl+C arrete Ollama-live + le proxy ; l'app repasse
# en demo statique.
#
set -euo pipefail
cd "$(dirname "$0")"

PROXY_PORT=11435
ORIGINS="http://localhost:*,http://127.0.0.1:*"   # Ollama n'ecoute qu'en local
say(){ printf "\033[0;32m[live]\033[0m %s\n" "$1"; }
warn(){ printf "\033[0;33m[live]\033[0m %s\n" "$1"; }

[ -f live-bridge/.secret ] || { warn "live-bridge/.secret manquant (ORIGIN_SECRET=...). Voir README."; exit 1; }
# shellcheck disable=SC1091
set -a; . live-bridge/.secret; set +a
[ -n "${ORIGIN_SECRET:-}" ] || { warn "ORIGIN_SECRET vide dans live-bridge/.secret"; exit 1; }

# --- Ollama en ecoute locale uniquement ----------------------------------------
say "Configuration d'Ollama (origines locales)"
launchctl setenv OLLAMA_ORIGINS "${ORIGINS}" 2>/dev/null || export OLLAMA_ORIGINS="${ORIGINS}"
osascript -e 'quit app "Ollama"' 2>/dev/null || true
sleep 1
pkill -9 -f "Resources/ollama serve" 2>/dev/null || true
pkill -9 -f "ollama serve" 2>/dev/null || true
sleep 2
if [ -d "/Applications/Ollama.app" ]; then open -a Ollama; else
  OLLAMA_ORIGINS="${ORIGINS}" nohup ollama serve >/tmp/ollama-live.log 2>&1 &
fi
for i in $(seq 1 30); do curl -s -o /dev/null "http://localhost:11434/api/tags" && break; sleep 1; done
curl -s -o /dev/null "http://localhost:11434/api/tags" || { warn "Ollama ne repond pas."; exit 1; }
say "Ollama pret (local)."

# --- Proxy d'origine (exige ORIGIN_SECRET) -------------------------------------
say "Demarrage du proxy d'origine sur 127.0.0.1:${PROXY_PORT}"
trap 'kill %1 2>/dev/null || true; say "Proxy arrete. Live coupe (retour demo statique)."' EXIT INT TERM
ORIGIN_SECRET="${ORIGIN_SECRET}" node live-bridge/origin-proxy.mjs "${PROXY_PORT}" &

sleep 1
echo
echo "  ============================================================"
echo "   MODE LIVE ACTIF."
echo "   Lien a partager :  https://onatera-copilot.pages.dev"
echo "   -> le testeur clique \"Mode live\" et saisit le DEMO_TOKEN."
echo "   Laisse cette fenetre ouverte pendant la demo. Ctrl+C pour arreter."
echo "  ============================================================"
echo
wait
