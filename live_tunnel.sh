#!/usr/bin/env bash
#
# Demo LIVE depuis l'URL en ligne.
# --------------------------------
# Expose l'Ollama LOCAL derriere un tunnel Cloudflare (https public), puis
# imprime le lien a ouvrir : https://onatera-copilot.pages.dev/?ollama=<tunnel>
#
# La page en ligne detecte ce tunnel et bascule en MODE LIVE. Sans le tunnel,
# la meme URL reste en mode demo (pre-calcule) - donc testable par n'importe qui.
#
# Confidentialite : le modele reste sur CETTE machine (aucun LLM tiers). Le texte
# du ticket transite par le tunnel chiffre Cloudflare jusqu'a l'Ollama local.
# Ce n'est donc pas "zero octet ne sort" (ca, c'est ./run.sh en local pur).
#
# Prerequis : Ollama installe + `brew install cloudflared`.
# Arret : Ctrl+C (le tunnel se ferme ; l'app en ligne repasse en demo).
#
set -euo pipefail

APP_URL="https://onatera-copilot.pages.dev"
# Origines CORS autorisees cote Ollama : localhost + l'app en ligne (pas de '*').
ORIGINS="http://localhost:*,http://127.0.0.1:*,${APP_URL}"

say(){ printf "\033[0;32m[live]\033[0m %s\n" "$1"; }
warn(){ printf "\033[0;33m[live]\033[0m %s\n" "$1"; }

command -v cloudflared >/dev/null 2>&1 || { warn "cloudflared manquant : brew install cloudflared"; exit 1; }
command -v ollama >/dev/null 2>&1 || warn "commande 'ollama' introuvable (l'app Ollama.app suffit)."

# --- 1. Autoriser l'origine de l'app dans Ollama et (RE)demarrer le serveur ----
# Important : l'app macOS ne relit OLLAMA_ORIGINS qu'au (re)lancement du process
# 'ollama serve'. On le tue franchement pour forcer la prise en compte.
say "Configuration des origines Ollama (${ORIGINS})"
launchctl setenv OLLAMA_ORIGINS "${ORIGINS}" 2>/dev/null || export OLLAMA_ORIGINS="${ORIGINS}"
osascript -e 'quit app "Ollama"' 2>/dev/null || true
sleep 1
pkill -9 -f "Resources/ollama serve" 2>/dev/null || true
pkill -9 -f "ollama serve" 2>/dev/null || true
sleep 2
if [ -d "/Applications/Ollama.app" ]; then
  open -a Ollama
else
  OLLAMA_ORIGINS="${ORIGINS}" nohup ollama serve >/tmp/ollama-live.log 2>&1 &
fi
say "Attente d'Ollama..."
for i in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:11434/api/tags" && break
  sleep 1
done
curl -s -o /dev/null "http://localhost:11434/api/tags" || { warn "Ollama ne repond pas."; exit 1; }
say "Ollama pret."

# --- 2. Tunnel Cloudflare ------------------------------------------------------
# Gotchas appris a la dure :
#  --config /dev/null      : ignore un eventuel ~/.cloudflared/config.yml (tunnel
#                            nomme) qui casserait le routage du quick tunnel.
#  --http-host-header ...  : Ollama refuse les requetes dont le Host n'est pas local.
say "Ouverture du tunnel Cloudflare..."
pkill -f "cloudflared tunnel --config /dev/null --url http://localhost:11434" 2>/dev/null || true
LOG="$(mktemp)"
cloudflared tunnel --config /dev/null \
  --url http://localhost:11434 \
  --http-host-header localhost:11434 >"${LOG}" 2>&1 &
TPID=$!
trap 'kill ${TPID} 2>/dev/null || true; say "Tunnel ferme."' EXIT INT TERM

URL=""
for i in $(seq 1 30); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${LOG}" | head -1 || true)"
  [ -n "${URL}" ] && break
  sleep 1
done
[ -n "${URL}" ] || { warn "URL de tunnel introuvable. Log : ${LOG}"; exit 1; }

say "Attente de la disponibilite du tunnel (peut prendre ~30 s)..."
ok=""
for i in $(seq 1 30); do
  if curl -s -m 5 "${URL}/" 2>/dev/null | grep -qi "ollama is running"; then ok=1; break; fi
  sleep 3
done
[ -n "${ok}" ] || warn "Le tunnel n'a pas encore repondu ; il peut se stabiliser dans un instant."

echo
echo "  ============================================================"
echo "   LIEN LIVE (a ouvrir / projeter pendant la presentation) :"
echo
echo "   ${APP_URL}/?ollama=${URL}"
echo
echo "   La meme URL SANS le ?ollama=... reste en mode demo."
echo "   Ctrl+C pour arreter le tunnel."
echo "  ============================================================"
echo

wait ${TPID}
