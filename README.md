# Onatera Copilot

**Un prototype d'aide à la décision pour un service client santé (compléments alimentaires).** Il matérialise une méthode : triage d'un ticket, recherche documentaire sourcée, escalade selon des règles métier bloquantes, et **validation humaine obligatoire**.

> Cas pratique de recrutement — Responsable Service Client @ Onatera. Livrable bonus.
>
> **Ce que ce n'est pas** : ni un dispositif médical, ni un moteur de décision autonome, ni un outil prêt à traiter des données de santé réelles en production. C'est une démonstration de méthode et de garde-fous.

## Trois modes, trois niveaux de confidentialité

Le discours de confidentialité est **différent selon le mode** — aucune promesse absolue « aucune donnée ne sort » quand ce n'est pas vrai.

| Mode | Où tourne le LLM | Où vont les données saisies |
|------|------------------|-----------------------------|
| **Démo statique** (lien public) | nulle part — rien n'est analysé | **nulle part** : un exemple pré-calculé proche est affiché à titre d'illustration ; aucune requête réseau au chargement, aucune journalisation |
| **Live local** (`./run.sh`) | sur la machine (Ollama `:11434`) | restent **locales** |
| **Live distant protégé** (pont sécurisé) | sur la machine | transitent par un **tunnel chiffré + authentifié** — à réserver à des données de **test** |

Dans tous les cas, le LLM est **toujours local** (jamais un service d'IA tiers), et **aucune réponse n'est envoyée automatiquement**.

## Démo en ligne

➡️ **[Ouvrir la démo statique](https://onatera-copilot.pages.dev)** — testable par n'importe qui, sans rien installer. Aucun ticket saisi n'est analysé ni envoyé : un exemple pré-calculé est rejoué avec la même animation qu'en direct.

## Le principe en 5 lignes

1. **Triage** (LLM, sortie structurée) — catégorie suggérée, criticité, urgence sanitaire, signaux d'escalade.
2. **Recherche documentaire** (déterministe) — fiches produit / réglementaires / pages d'aide, avec score.
3. **Rédaction sourcée** (LLM, streaming) — un mail à relire + les actions internes à déclencher ; sur une demande de conseil *sans contre-indication*, une recommandation de produits (prix + points de vigilance).
4. **Garde-fous déterministes** — règles métier **bloquantes**, câblées en dur (`js/safety.js`), jamais confiées au modèle.
5. **Validation humaine** — l'outil propose, l'humain valide. Sur un dossier critique, la copie est **verrouillée**.

## Les garde-fous (le vrai différenciateur)

Toute la logique bloquante est dans [`js/safety.js`](js/safety.js), **testée** (`npm test`) et indépendante du texte généré par le LLM :

- **Contexte de sécurité déterministe** — `computeSafetyContext(ticket, triage)` détecte, à partir du texte : grossesse/allaitement, mineur/personne vulnérable, traitement en cours, interaction, effet indésirable, surdosage, hospitalisation, atteinte corporelle, décès, menaces (DGCCRF / avocat / média), pathologie/diagnostic. **Sur un cas ambigu, on sur-escalade.**
- **Recommandations produits bloquées** — aucune reco si grossesse, mineur, traitement, effet indésirable/interaction/surdosage/hospitalisation, criticité haute/critique, ou catégorie ≠ information/conseil. Le modèle a beau en produire : elles sont **supprimées en post-traitement**.
- **Niveau de validation déterministe** (remplace un « % de confiance » non calibré) — `standard` / `manager` / `quality` / `legal_nutrivigilance`, avec les validateurs requis et la raison affichés.
- **Fail-closed** — dossier `critique` ou `legal_nutrivigilance` : réponse **verrouillée**, bouton *Copier* désactivé, « validation interne obligatoire avant utilisation ». Pas de déverrouillage fictif dans la démo.
- **Formulations à risque** — détection déterministe (causalité, responsabilité, diagnostic/prescription, engagement financier) : surlignage **+** hausse du niveau de validation, jamais un simple signal cosmétique.
- **Escalade forcée** — hospitalisation / atteinte corporelle / décès ⇒ **critique** + escalade Juridique / Direction / Nutrivigilance ANSES, quoi qu'en dise le modèle.

## Exécution en local (mode live local)

```bash
git clone https://github.com/Demande-a-Kevin/onatera-care-copilot.git
cd onatera-care-copilot
ollama pull qwen2.5:7b-instruct          # analyse "Complète"
ollama pull qwen2.5:3b-instruct          # (optionnel) analyse "Rapide"
./run.sh
```

`run.sh` démarre Ollama avec le bon `OLLAMA_ORIGINS`, sert le dossier sur `http://localhost:8080` et ouvre le navigateur. **Ne pas** ouvrir `index.html` en `file://` (les modules ES ne se chargent pas ; CORS échoue). Si Ollama est éteint, l'app bascule en mode démo sans erreur.

## Mode live distant protégé (à partager avec Onatera)

Le lien partagé reste **https://onatera-copilot.pages.dev** (démo statique par défaut). Le testeur clique sur **« Mode live »** et saisit un **jeton d'accès** (communiqué hors bande). L'**API Ollama n'est jamais exposée directement** : les appels passent par un pont authentifié.

```
navigateur --(jeton DEMO_TOKEN)--> Worker "onatera-copilot-live"  (CORS verrouillé,
           routes + modèles + taille limités, rate-limit)
           --(secret ORIGIN_SECRET)--> tunnel Cloudflare nommé
           --> proxy d'origine local (127.0.0.1:11435, exige le secret)
           --> Ollama (127.0.0.1:11434, écoute uniquement en local)
```

Mise en place (voir [`live-bridge/`](live-bridge/)) :

```bash
# 1. Déployer le Worker pont + ses secrets
cd live-bridge
npx wrangler deploy
openssl rand -hex 24 | npx wrangler secret put DEMO_TOKEN      # jeton pour Onatera
openssl rand -hex 32 | npx wrangler secret put ORIGIN_SECRET   # secret d'origine
# 2. Reporter le même ORIGIN_SECRET dans live-bridge/.secret (gitignoré) :
#    echo "ORIGIN_SECRET=<valeur>" > live-bridge/.secret
# 3. Pointer l'ingress du tunnel nommé sur le proxy d'origine :
#    ~/.cloudflared/config.yml : ollama-copilot.kev1ncockpit.com -> http://localhost:11435
# 4. Lancer côté machine du présentateur :
./live_tunnel.sh
```

> **Confidentialité (live distant)** : le modèle reste local, mais le texte du ticket transite par le tunnel chiffré. Ce n'est **pas** « zéro octet ne sort » — ça, c'est `./run.sh` en local pur. À réserver à des données de test.

## Tests

Règles déterministes testées avec le runner Node intégré (aucune dépendance) :

```bash
npm test        # node --test
```

Couvre les cas obligatoires : hospitalisation ⇒ critique + `legal_nutrivigilance` ; grossesse/traitement ⇒ aucune recommandation ; demande logistique ⇒ pas d'escalade sanitaire ; menace DGCCRF ⇒ Qualité + Juridique ; formulation causale ⇒ verrouillage ; télémétrie ⇒ ni ticket ni réponse ; mode public ⇒ aucun appel réseau au chargement ; ticket libre ⇒ bandeau « illustration pré-calculée ».

## Suivi des tests de la démo (`monitor/`)

Pour cette **démo de recrutement**, un Worker (`monitor/`) enregistre les tickets testés + la réponse proposée, afin de voir ce que les testeurs essaient. Corrige les failles de l'ancienne version :

- jeton d'accès **jamais dans l'URL** (formulaire → en-tête `Authorization`) ;
- **CORS verrouillé** sur les origines de la démo ;
- stockage **par enregistrement** (une clé KV par test, pas de course à l'écriture) ;
- **aucune IP / ville / pays** ; **rétention 14 j** (TTL) affichée ; page `noindex`.

L'app l'**annonce** (bandeau : « les tickets testés sont enregistrés »). À réserver à des testeurs connus, pas de données personnelles réelles. Page : `https://onatera-copilot-monitor.<sub>.workers.dev/` (login par jeton). Déploiement : `cd monitor && npx wrangler deploy` + `npx wrangler secret put MONITOR_TOKEN`.

## Base de connaissance

`data/kb.json` (~171 entrées) = fiches réglementaires + posture curées à la main ([`data/kb_curated.json`](data/kb_curated.json)) + fiches produit « Énergie & Vitalité » (nom, référence, **prix**, allégations, précautions) + pages éditoriales, **ingérées hors-ligne** depuis onatera.com par [`scripts/ingest_onatera.py`](scripts/ingest_onatera.py). Rien n'est scrapé pendant l'analyse d'un ticket.

```bash
python3 scripts/ingest_onatera.py     # reconstruit data/kb.json
```

## Limites assumées (sans les minimiser)

- **Détection déterministe non exhaustive** — les regex de `computeSafetyContext` et des formulations à risque attrapent les cas fréquents, pas tous. Elles complètent la relecture humaine, elles ne la remplacent pas.
- **Contenus produit relevés automatiquement** — allégations/précautions à **revalider** par Qualité / Juridique avant tout usage réel.
- **Recherche documentaire lexicale** — volontairement simple ; suffisante à cette échelle.
- **LLM local** — arbitrage confidentialité / finesse rédactionnelle assumé ; un 3B/7B peut dériver (d'où les garde-fous en dur).
- **Pont live distant** — dépend d'un tunnel + d'un proxy sur la machine du présentateur ; à **tester de bout en bout** avant toute démonstration. Données de test uniquement.
- `data/demo_outputs.json` est régénérable — voir [`scripts/generate_demo_outputs.md`](scripts/generate_demo_outputs.md).

## Structure

```
onatera-care-copilot/
├── index.html            # l'app (module ES : importe js/safety.js + js/telemetry.js)
├── js/
│   ├── safety.js         # garde-fous déterministes (testés)
│   └── telemetry.js      # télémétrie métadonnées-only (désactivée) + politique d'egress
├── test/                 # tests Node (node --test), zéro dépendance
├── data/                 # kb.json, kb_curated.json, tickets.json, demo_outputs.json
├── scripts/              # ingester offline + doc de génération des démos
├── live-bridge/          # pont live SÉCURISÉ : Worker proxy + proxy d'origine local
├── run.sh                # démo LOCALE (Ollama + serveur statique)
├── live_tunnel.sh        # démo LIVE distante sécurisée
├── package.json          # "type": module + script test (aucune dépendance)
└── README.md
```

---

*Licence MIT.*
