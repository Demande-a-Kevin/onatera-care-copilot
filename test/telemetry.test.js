// Tests de la telemetrie et de la politique d'egress reseau (brief 3.1 / 3.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TELEMETRY_ENABLED,
  ALLOWED_TELEMETRY_KEYS,
  buildTelemetryPayload,
  sendTelemetry,
  DEFAULT_LIVE_ENDPOINT,
  shouldAutoConnectOnLoad,
} from '../js/telemetry.js';

/* ---------- telemetrie : metadonnees uniquement ---------- */

test('la telemetrie est desactivee par defaut', () => {
  assert.equal(TELEMETRY_ENABLED, false);
});

test('le payload de telemetrie ne contient NI le ticket NI la reponse', () => {
  const p = buildTelemetryPayload({
    mode: 'demo', model: 'qwen2.5:7b',
    categorie: 'risque_sanitaire', criticite: 'critique',
    validationLevel: 'legal_nutrivigilance',
    stepDurations: [1.2, 0.3, 8.1], sourcesCount: 4, recoCount: 0,
    guardFlags: ['reco_suppressed', 'locked'], status: 'ok',
    // champs interdits que l'on tente d'injecter : doivent etre ignores
    ticket: 'Je suis enceinte et je prends du millepertuis',
    reponse: 'Bonjour Madame, ...',
    symptomes: 'nausees', reponse_client: 'texte',
  });
  const keys = Object.keys(p);
  assert.ok(!keys.includes('ticket'), 'aucun ticket');
  assert.ok(!keys.includes('reponse'), 'aucune reponse');
  assert.ok(!keys.includes('reponse_client'), 'aucune reponse_client');
  assert.ok(!keys.includes('symptomes'), 'aucun symptome');
  // toutes les cles presentes sont dans la liste blanche
  for (const k of keys) assert.ok(ALLOWED_TELEMETRY_KEYS.includes(k), 'cle autorisee: ' + k);
  // un identifiant de run aleatoire est genere
  assert.ok(typeof p.run_id === 'string' && p.run_id.length >= 6);
});

test('sendTelemetry n’emet AUCUNE requete quand desactivee', async () => {
  let called = 0;
  const fakeFetch = () => { called++; return Promise.resolve({ ok: true }); };
  await sendTelemetry({ run_id: 'abc123' }, { enabled: false, endpoint: 'https://x/log', fetchImpl: fakeFetch });
  assert.equal(called, 0);
});

test('sendTelemetry n’emet rien sans endpoint, meme si activee', async () => {
  let called = 0;
  const fakeFetch = () => { called++; return Promise.resolve({ ok: true }); };
  await sendTelemetry({ run_id: 'abc123' }, { enabled: true, endpoint: '', fetchImpl: fakeFetch });
  assert.equal(called, 0);
});

/* ---------- egress reseau : rien ne part a l'ouverture du lien public ---------- */

test('aucun endpoint Ollama distant n’est bake dans le bundle', () => {
  assert.equal(DEFAULT_LIVE_ENDPOINT, '');
});

test('mode public (hebergé) : aucune connexion live automatique au chargement', () => {
  assert.equal(shouldAutoConnectOnLoad({ isLocal: false, savedEndpoint: '' }), false);
});

test('un endpoint distant memorise ne se reconnecte pas tout seul en public', () => {
  // meme si l'utilisateur avait sauvegarde une URL, on ne se connecte pas sans action explicite
  assert.equal(shouldAutoConnectOnLoad({ isLocal: false, savedEndpoint: 'https://x' }), false);
});

test('en local (localhost), la connexion Ollama peut se faire automatiquement', () => {
  assert.equal(shouldAutoConnectOnLoad({ isLocal: true, savedEndpoint: '' }), true);
});
