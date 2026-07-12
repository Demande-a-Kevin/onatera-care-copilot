# Regenerer `data/demo_outputs.json` a partir d'executions REELLES

Le mode demo (GitHub Pages, ou Ollama eteint) rejoue `data/demo_outputs.json`.
Pour que ces sorties soient **authentiques** (et non ecrites a la main), on les
regenere en faisant reellement tourner le pipeline en local, puis on copie les
sorties du modele.

## Prerequis
```bash
ollama pull qwen2.5:7b-instruct
./run.sh                 # dans un terminal
```

## Methode 1 - depuis l'app (la plus simple)
1. Ouvrir http://localhost:8080 en **mode live** (pastille verte).
2. Charger chaque ticket d'exemple (#4471, #4502, #4529, #4518) et cliquer **Analyser**.
3. Pour chaque etape, deplier **"Voir le JSON brut"** :
   - etape 1 -> objet `triage`
   - etape 2 -> liste `retrieved` (les fiches affichees avec leur score)
   - etape 3 -> objet `redaction` **BRUT** (avant garde-fous)
4. Recopier ces trois objets dans `outputs["<id_ticket>"]` de `data/demo_outputs.json`.

> Important : stocker le `redaction` **brut du modele**, pas la version corrigee
> par les garde-fous. Le mode demo re-applique les garde-fous deterministes
> par-dessus (c'est ce qui permet de montrer l'escalade forcee du ticket #4529).

## Methode 2 - script curl (reproductible)
Le pipeline appelle l'API `POST /api/chat` d'Ollama avec sortie structuree.
Exemple pour l'etape 1 (triage) :
```bash
curl -s http://localhost:11434/api/chat -d '{
  "model": "qwen2.5:7b-instruct",
  "stream": false,
  "options": {"temperature": 0.1},
  "format": { ...schema TRIAGE_SCHEMA du index.html... },
  "messages": [
    {"role":"system","content":"<TRIAGE_SYS du index.html>"},
    {"role":"user","content":"<texte du ticket>"}
  ]
}' | jq -r '.message.content'
```
Repeter pour l'etape 3 avec `REDACTION_SCHEMA` et le prompt `redactionSys()`
(en injectant les fiches KB retenues a l'etape 2). Les schemas et prompts exacts
sont dans `index.html` (constantes `TRIAGE_SCHEMA`, `REDACTION_SCHEMA`,
`TRIAGE_SYS`, `redactionSys`).

## Verification
- Les 4 tickets se deroulent en < 60 s chacun.
- Le ticket #4529 (vitamine D) doit, apres garde-fous, afficher niveau **critique**
  + escalade **juridique / direction / pharmacovigilance ANSES**.
- Aucune reponse ne doit contenir de reconnaissance de responsabilite (sinon le
  bandeau rouge s'affiche - c'est le filet, pas un bug).
