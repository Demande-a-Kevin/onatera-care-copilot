# Care Copilot — Onatera

**Un copilote qui prépare le traitement d'un ticket client sensible en local, sans envoyer une seule donnée à un tiers.** Pour un service client santé (compléments alimentaires), il fait gagner à l'agent les ~30 minutes de recherche documentaire et lui livre une base **sourcée** qu'il valide, corrige et signe.

> Cas pratique de recrutement — Responsable Service Client @ Onatera. Livrable bonus : montrer comment j'industrialiserais le traitement de ce type de ticket avec un LLM local et des garde-fous métier.

## Démo en ligne

➡️ **[Ouvrir la démo (GitHub Pages)](https://<user>.github.io/onatera-care-copilot/)**
*(remplacez `<user>` après publication — Settings → Pages → Source `main` / root)*

En ligne, l'app tourne en **mode démo** : elle rejoue des résultats réels pré-calculés, avec la même animation et le même rendu qu'en direct. Pour l'exécution live avec un LLM local, voir plus bas.

*(Ajouter ici une capture d'écran ou un GIF du pipeline qui tourne.)*

## Le principe en 5 lignes

1. **Triage** (LLM, sortie structurée) — catégorie, gravité, urgence sanitaire, signaux d'escalade.
2. **Recherche documentaire** (déterministe) — les fiches produit + réglementaires pertinentes, affichées avec leur score.
3. **Rédaction sourcée** (LLM, streaming) — un mail prêt à relire, appuyé uniquement sur les fiches retenues.
4. **Garde-fous** — règles métier non négociables câblées en dur (pas confiées au modèle).
5. **Validation humaine** — rien n'est envoyé automatiquement. L'outil propose, l'humain valide.

## Exécution en local avec le LLM

```bash
git clone https://github.com/<user>/onatera-care-copilot.git
cd onatera-care-copilot
ollama pull qwen2.5:7b-instruct
./run.sh
```

`run.sh` démarre Ollama avec le bon `OLLAMA_ORIGINS` (indispensable pour un appel depuis le navigateur), sert le dossier en statique sur `http://localhost:8080` et ouvre le navigateur.

- **Ne pas** ouvrir `index.html` en `file://` (l'origine vaut `null`, CORS échoue).
- Si Ollama est éteint ou indisponible, l'app **bascule automatiquement en mode démo**, sans erreur.
- Modèle par défaut : `qwen2.5:7b-instruct`. Alternatives sélectionnables dans l'UI si installées : `qwen2.5:3b-instruct`, `llama3.1:8b-instruct`.

## Les garde-fous (le vrai différenciateur)

Câblés à deux niveaux — dans le prompt système **et** en post-traitement déterministe, parce qu'un modèle 7B local peut dériver :

- **Aucune reconnaissance de responsabilité** ni de lien de causalité. Reconnaître un défaut d'information est autorisé ; reconnaître que le produit a causé le dommage, non.
- **Aucun conseil médical** — renvoi systématique vers médecin/pharmacien.
- **Aucune affirmation absente des fiches** — si l'info manque (ex. bulletins d'analyses métaux lourds), on le dit et on promet un retour documenté ; jamais un chiffre inventé.
- **Aucun engagement commercial chiffré** — `[à définir avec le manager]`.
- **Escalade forcée** — hospitalisation / atteinte corporelle ⇒ risque **critique** + escalade juridique / direction / pharmacovigilance ANSES, quoi qu'en dise le modèle.
- **Blocklist de formulations** — toute reconnaissance de responsabilité déclenche un bandeau rouge et surligne le passage, **sans censurer** (montrer que le filet existe).

## Limites assumées

- **Base de connaissance construite à la main** sur 6 fiches produit — pas d'ingestion automatique du catalogue.
- **Modèle 7B local** : arbitrage confidentialité / finesse rédactionnelle assumé.
- **Aucune réponse n'est envoyée automatiquement.** L'outil propose, l'humain valide.
- **Données produit et réglementaires relevées à la main** — à revalider par les services Qualité / Juridique avant tout usage réel.
- `data/demo_outputs.json` est **régénérable à partir d'exécutions réelles** — voir [`scripts/generate_demo_outputs.md`](scripts/generate_demo_outputs.md).

## Et après ?

- Embeddings locaux (`nomic-embed-text`) au-delà de ~100 fiches — même stack, aucune dépendance externe.
- Connexion à l'outil de ticketing / CRM (Zendesk, Freshdesk…).
- Boucle de feedback agent : chaque correction humaine ré-alimente prompts et KB.
- Jeu de tickets annotés pour mesurer la qualité (catégorisation, escalade, absence de formulation à risque).

## Confidentialité & coût

Aucun secret, aucune clé API, aucun `.env`, aucune base, aucun serveur : **c'est un argument, pas un manque.** Le modèle tourne en local ; aucune donnée client ne sort de la machine. Hébergement statique gratuit (GitHub Pages).

## Structure

```
onatera-care-copilot/
├── index.html            # l'app (HTML + CSS + JS, un seul fichier)
├── data/
│   ├── kb.json           # base de connaissance (12 entrées)
│   ├── tickets.json      # 4 tickets d'exemple
│   └── demo_outputs.json # sorties réelles pré-calculées (mode démo)
├── scripts/
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
