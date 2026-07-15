#!/usr/bin/env bash
#
# A LANCER UNE SEULE FOIS. Configure les 3 secrets Cloudflare necessaires :
#   - pont live  : ORIGIN_SECRET (doit correspondre a live-bridge/.secret) + DEMO_TOKEN
#   - suivi      : MONITOR_TOKEN
# Genere DEMO_TOKEN et MONITOR_TOKEN si absents, les enregistre chez Cloudflare,
# puis les affiche a la fin (jeton pour Alizee + jeton pour la page de suivi).
#
# Prerequis : etre connecte a wrangler (npx wrangler login) - deja fait.
#
set -euo pipefail
cd "$(dirname "$0")"

say(){ printf "\033[0;32m[setup]\033[0m %s\n" "$1"; }

# --- 1. ORIGIN_SECRET (pont live) : lu depuis live-bridge/.secret --------------
[ -f live-bridge/.secret ] || { echo "live-bridge/.secret manquant"; exit 1; }
# shellcheck disable=SC1091
. live-bridge/.secret
say "Enregistrement de ORIGIN_SECRET (pont live)..."
( cd live-bridge && printf '%s' "$ORIGIN_SECRET" | npx wrangler secret put ORIGIN_SECRET )

# --- 2. DEMO_TOKEN (jeton du mode live pour Alizee) ---------------------------
[ -f .demo_token ] || openssl rand -hex 20 > .demo_token
DEMO_TOKEN="$(tr -d '[:space:]' < .demo_token)"
say "Enregistrement de DEMO_TOKEN (pont live)..."
( cd live-bridge && printf '%s' "$DEMO_TOKEN" | npx wrangler secret put DEMO_TOKEN )

# --- 3. MONITOR_TOKEN (page de suivi des tests) -------------------------------
[ -f .monitor_token ] || openssl rand -hex 20 > .monitor_token
MONITOR_TOKEN="$(tr -d '[:space:]' < .monitor_token)"
say "Enregistrement de MONITOR_TOKEN (suivi)..."
( cd monitor && printf '%s' "$MONITOR_TOKEN" | npx wrangler secret put MONITOR_TOKEN )

echo
echo "  =============================================================="
echo "   C'EST FAIT. Note ces deux informations :"
echo
echo "   >> A DONNER A ALIZEE (pour le \"Mode live\") :"
echo "      Code d'acces = ${DEMO_TOKEN}"
echo
echo "   >> POUR TOI (voir ce que les gens testent) :"
echo "      Page : https://onatera-copilot-monitor.kev1n-cockpit.workers.dev/"
echo "      Jeton = ${MONITOR_TOKEN}"
echo "  =============================================================="
echo
echo "  (Ces jetons sont aussi dans les fichiers .demo_token et .monitor_token.)"
