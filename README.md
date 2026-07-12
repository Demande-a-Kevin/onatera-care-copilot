# Onatera Copilot

**Un copilote qui prépare le traitement d'un ticket client sensible en local, sans envoyer une seule donnée à un tiers.** Pour un service client santé (compléments alimentaires), il fait gagner à l'agent les ~30 minutes de recherche documentaire et lui livre une base **sourcée** qu'il valide, corrige et signe.

> Cas pratique de recrutement — Responsable Service Client @ Onatera. Livrable bonus : montrer comment j'industrialiserais le traitement de ce type de ticket avec un LLM local et des garde-fous métier.

## Démo en ligne

➡️ **[Ouvrir la démo (GitHub Pages)](https://<user>.github.io/onatera-care-copilot/)**
*(remplacez `<user>` après publication — Settings → Pages → Source `main` / root)*

En ligne, l'app tourne en **mode démo** : elle rejoue des résultats réels pré-calculés, avec la même animation et le même rendu qu'en direct. Pour l'exécution live avec un LLM local, voir plus bas.

*(Ajouter ici une capture d'écran ou un GIF du pipeline qui tourne.)*

## Le principe en 5 lignes

1. **Triage** (LLM, sortie structurée) — catégorie **suggérée** (risque sanitaire, réglementaire, sécurité produit, livraison, commande, information/conseil…), criticité, urgence sanitaire, signaux d'escalade.
2. **Recherche documentaire** (déterministe) — les fiches produit + réglementaires + pages d'aide pertinentes, affichées avec leur score.
3. **Rédaction sourcée** (LLM, streaming) — un mail prêt à relire **et les actions internes à déclencher** (qui alerter, quoi remonter, dans quel délai), appuyés uniquement sur les fiches retenues.
4. **Garde-fous** — règles métier non négociables câblées en dur (pas confiées au modèle).
5. **Validation humaine** — rien n'est envoyé automatiquement. L'outil propose, l'humain valide.

## Exécution en local avec le LLM

```bash
git clone https://github.com/<user>/onatera-care-copilot.git
cd onatera-care-copilot
ollama pull qwen2.5:7b-instruct          # analyse "Complète"
ollama pull qwen2.5:3b-instruct          # (optionnel) analyse "Rapide"
./run.sh
```

`run.sh` démarre Ollama avec le bon `OLLAMA_ORIGINS` (indispensable pour un appel depuis le navigateur), sert le dossier en statique sur `http://localhost:8080` et ouvre le navigateur.

- **Ne pas** ouvrir `index.html` en `file://` (l'origine vaut `null`, CORS échoue).
- Si Ollama est éteint ou indisponible, l'app **bascule automatiquement en mode démo**, sans erreur.
- **Profondeur d'analyse** : *Rapide* (petit modèle, 1er jet sur un ticket simple) ou *Complète* (modèle plus capable, ticket sensible). Le bon modèle installé est **choisi automatiquement** — pas de sélecteur à régler.

## Les garde-fous (le vrai différenciateur)

Câblés à deux niveaux — dans le prompt système **et** en post-traitement déterministe, parce qu'un modèle 7B local peut dériver :

- **Aucune reconnaissance de responsabilité** ni de lien de causalité. Reconnaître un défaut d'information est autorisé ; reconnaître que le produit a causé le dommage, non.
- **Aucun conseil médical** — renvoi systématique vers médecin/pharmacien.
- **Aucune affirmation absente des fiches** — si l'info manque (ex. bulletins d'analyses métaux lourds), on le dit et on promet un retour documenté ; jamais un chiffre inventé.
- **Aucun engagement commercial chiffré** — `[à définir avec le manager]`.
- **Escalade forcée** — hospitalisation / atteinte corporelle ⇒ risque **critique** + escalade juridique / direction / pharmacovigilance ANSES, quoi qu'en dise le modèle.
- **Blocklist de formulations** — toute reconnaissance de responsabilité déclenche un bandeau rouge et surligne le passage, **sans censurer** (montrer que le filet existe).

## Base de connaissance

La base (`data/kb.json`, ~166 entrées) combine :

- des **fiches réglementaires + posture curées à la main** (vérifiées, liées aux cas sensibles) — dans `data/kb_curated.json` ;
- les **fiches produit de la catégorie « Énergie & Vitalité »** + quelques **pages d'aide** (livraisons, conseils, support), **ingérées automatiquement** depuis onatera.com par [`scripts/ingest_onatera.py`](scripts/ingest_onatera.py).

L'ingestion est **hors-ligne** : elle fige une base **locale** que le LLM consulte à la volée. Rien n'est scrapé pendant l'analyse d'un ticket → la promesse « aucune donnée ne sort » tient. Régénérer :

```bash
python3 scripts/ingest_onatera.py     # reconstruit data/kb.json
```

## Limites assumées

- **Contenus produit relevés automatiquement** — allégations et précautions à **revalider par les services Qualité / Juridique** avant tout usage réel.
- **Recherche documentaire lexicale** (mots-clés pondérés), volontairement simple et lisible ; suffisante à cette échelle.
- **LLM local** : arbitrage confidentialité / finesse rédactionnelle assumé.
- **Aucune réponse n'est envoyée automatiquement.** L'outil propose, l'humain valide.
- `data/demo_outputs.json` est **régénérable à partir d'exécutions réelles** — voir [`scripts/generate_demo_outputs.md`](scripts/generate_demo_outputs.md).

## Et après ?

- Ingestion automatisée et périodique de tout le catalogue (l'ingester actuel couvre une catégorie).
- Recherche sémantique locale (embeddings `nomic-embed-text`) si la base grossit fortement — même stack, aucune dépendance externe.
- Connexion à l'outil de ticketing / CRM (Zendesk, Freshdesk…).
- Boucle de feedback agent : chaque correction humaine ré-alimente prompts et base.
- Jeu de tickets annotés pour mesurer la qualité (catégorisation, escalade, absence de formulation à risque).

## Confidentialité & coût

Aucun secret, aucune clé API, aucun `.env`, aucune base, aucun serveur : **c'est un argument, pas un manque.** Le modèle tourne en local ; aucune donnée client ne sort de la machine. Hébergement statique gratuit (GitHub Pages).

## Structure

```
onatera-care-copilot/
├── index.html            # l'app (HTML + CSS + JS, un seul fichier)
├── data/
│   ├── kb.json           # base de connaissance générée (~166 entrées)
│   ├── kb_curated.json   # fiches réglementaires + posture curées (base stable)
│   ├── tickets.json      # 4 tickets d'exemple
│   └── demo_outputs.json # sorties réelles pré-calculées (mode démo)
├── scripts/
│   ├── ingest_onatera.py       # ingester offline -> data/kb.json
│   └── generate_demo_outputs.md
├── run.sh
├── README.md
└── LICENSE               # MIT
```

## Architecture

```
navigateur (localhost:8080)          machine locale
┌────────────────────────────┐      ┌──────────────────────┐
│  index.html (vanilla JS)   │─────▶│  Ollama :11434       │
│  ├─ kb.json                │      │  qwen2.5:7b-instruct │
│  └─ pipeline 3 étapes      │◀─────│  (streaming)         │
└────────────────────────────┘      └──────────────────────┘
        aucune donnée ne sort de la machine
```

En HTTPS (GitHub Pages), le mode live n'existe pas : le navigateur ne peut pas appeler `localhost:11434` de façon fiable (mixed content + Private Network Access). Le mode live n'existe qu'en local — c'est voulu.

---

*Licence MIT. Auteur : Patrick « Maui » Le Cointre.*
