#!/usr/bin/env bash
#
# Demo LIVE DISTANTE SECURISEE (a partager avec Onatera).
# ------------------------------------------------------
# Architecture (le moteur Ollama n'est JAMAIS expose directement) :
#
#   navigateur --(jeton DEMO_TOKEN)--> Worker "onatera-copilot-live"
#              --(secret ORIGIN_SECRET)--> tunnel Cloudflare nomme
#              --> proxy d'origine local (127.0.0.1:11435, exige le secret)
#              --> Ollama (127.0.0.1:11434, ecoute UNIQUEMENT en local)
#
# Prerequis :
#   - Ollama installe, cloudflared installe et tunnel nomme configure dont
#     l'ingress "ollama-copilot.kev1ncockpit.com" pointe sur http://localhost:11435
#     (le proxy d'origine, PAS 11434).
#   - Worker deploye (voir live-bridge/) avec les secrets DEMO_TOKEN + ORIGIN_SECRET.
#   - Le fichier live-bridge/.secret contient : ORIGIN_SECRET=<meme valeur que le Worker>
#
# Le lien a partager est simplement https://onatera-copilot.pages.dev : le testeur
# clique sur "Mode live" et saisit le DEMO_TOKEN (communique hors bande).
#
# Arret : Ctrl+C (proxy + tunnel fermes ; l'app repasse en demo statique).
#
set -euo pipefail
cd "$(dirname "$0")"

APP_URL="https://onatera-copilot.pages.dev"
PROXY_PORT=11435
# Ollama n'ecoute qu'en local : seul le proxy d'origine le contacte.
ORIGINS="http://localhost:*,http://127.0.0.1:*"

say(){ printf "\033[0;32m[live]\033[0m %s\n" "$1"; }
warn(){ printf "\033[0;33m[live]\033[0m %s\n" "$1"; }

command -v cloudflared >/dev/null 2>&1 || { warn "cloudflared manquant : brew install cloudflared"; exit 1; }

# --- 0. Secret d'origine (partage avec le Worker) ------------------------------
[ -f live-bridge/.secret ] || { warn "live-bridge/.secret manquant (ORIGIN_SECRET=...). Voir README."; exit 1; }
# shellcheck disable=SC1091
set -a; . live-bridge/.secret; set +a
[ -n "${ORIGIN_SECRET:-}" ] || { warn "ORIGIN_SECRET vide dans live-bridge/.secret"; exit 1; }

# --- 1. (Re)demarrer Ollama en ecoute locale uniquement ------------------------
say "Configuration d'Ollama (origines locales : ${ORIGINS})"
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

# --- 2. Proxy d'origine (exige ORIGIN_SECRET) ----------------------------------
say "Demarrage du proxy d'origine sur 127.0.0.1:${PROXY_PORT}"
ORIGIN_SECRET="${ORIGIN_SECRET}" node live-bridge/origin-proxy.mjs "${PROXY_PORT}" &
PPID_PROXY=$!
sleep 1

# --- 3. Tunnel nomme (ingress -> 127.0.0.1:11435) ------------------------------
say "Demarrage du tunnel nomme (ingress doit pointer sur localhost:${PROXY_PORT})"
cloudflared tunnel run cockpit-tools >/tmp/onatera-tunnel.log 2>&1 &
TPID=$!

trap 'kill ${PPID_PROXY} ${TPID} 2>/dev/null || true; say "Proxy + tunnel fermes."' EXIT INT TERM

echo
echo "  ============================================================"
echo "   Pont live securise actif."
echo "   Lien a partager :  ${APP_URL}"
echo "   -> le testeur clique \"Mode live\" et saisit le DEMO_TOKEN."
echo "   Ollama n'est JAMAIS joignable sans le jeton + le secret d'origine."
echo "   Ctrl+C pour tout arreter."
echo "  ============================================================"
echo
wait ${TPID}
