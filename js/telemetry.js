/* =========================================================================
   Onatera Copilot - Telemetrie & politique d'egress reseau (module testable).

   Regle d'or (brief 3.1) : on ne journalise JAMAIS de contenu client.
   - pas de texte de ticket, pas de reponse generee, pas de symptome /
     traitement / donnee de sante, pas d'action interne detaillee, aucune
     donnee directement ou indirectement identifiante.
   - metadonnees anonymes uniquement, et DESACTIVEE PAR DEFAUT.

   Regle d'egress (brief 3.2) : aucun endpoint Ollama distant n'est bake dans
   le bundle public, et aucune connexion live ne part automatiquement au
   chargement d'une page hebergee. Le live est opt-in explicite.
   ========================================================================= */

// Telemetrie desactivee par defaut. Meme activee, elle n'emet que des
// metadonnees et seulement si un endpoint est fourni explicitement.
export const TELEMETRY_ENABLED = false;

// Aucun endpoint Ollama distant par defaut : le lien public ouvre la demo
// statique, sans tentative reseau vers la machine du presentateur.
export const DEFAULT_LIVE_ENDPOINT = '';

// Liste blanche STRICTE des cles autorisees dans un payload de telemetrie.
export const ALLOWED_TELEMETRY_KEYS = [
  'run_id',           // identifiant aleatoire du run
  'ts',               // horodatage
  'mode',             // 'demo' | 'local_live'
  'model',            // modele ou famille de modele
  'categorie',        // categorie de triage
  'criticite',        // criticite / gravite
  'validation_level', // niveau de validation requis
  'step_durations',   // duree des etapes [s]
  'sources_count',    // nombre de sources retrouvees
  'reco_count',       // nombre de recommandations
  'guard_flags',      // flags de garde-fous declenches
  'status',           // 'ok' | 'error'
];

function randomRunId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return 'run-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Construit un payload de telemetrie strictement limite aux metadonnees
 * autorisees. Tout champ non liste (ticket, reponse, symptomes...) est ignore.
 */
export function buildTelemetryPayload(input) {
  input = input || {};
  const out = {
    run_id: input.run_id || randomRunId(),
    ts: input.ts || new Date().toISOString(),
    mode: input.mode === 'live' ? 'local_live' : (input.mode || 'demo'),
    model: input.model || '',
    categorie: input.categorie || '',
    criticite: input.criticite || '',
    validation_level: input.validationLevel || input.validation_level || '',
    step_durations: Array.isArray(input.stepDurations) ? input.stepDurations
      : (Array.isArray(input.step_durations) ? input.step_durations : []),
    sources_count: Number(input.sourcesCount ?? input.sources_count ?? 0),
    reco_count: Number(input.recoCount ?? input.reco_count ?? 0),
    guard_flags: Array.isArray(input.guardFlags) ? input.guardFlags
      : (Array.isArray(input.guard_flags) ? input.guard_flags : []),
    status: input.status || 'ok',
  };
  // filet de securite : ne laisser passer que les cles de la liste blanche
  for (const k of Object.keys(out)) {
    if (!ALLOWED_TELEMETRY_KEYS.includes(k)) delete out[k];
  }
  return out;
}

/**
 * Emet la telemetrie UNIQUEMENT si explicitement activee ET un endpoint fourni.
 * Fire-and-forget, ne jette jamais. Le fetch est injectable pour les tests.
 */
export async function sendTelemetry(payload, opts) {
  opts = opts || {};
  const enabled = opts.enabled ?? TELEMETRY_ENABLED;
  const endpoint = opts.endpoint || DEFAULT_LIVE_ENDPOINT_LOG();
  if (!enabled || !endpoint) return; // desactivee ou pas d'endpoint -> rien ne part
  const doFetch = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return;
  try {
    await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(payload),
    });
  } catch (_) { /* silencieux : la telemetrie ne doit jamais casser l'app */ }
}
// Pas d'endpoint de log par defaut (le worker de journalisation est supprime).
function DEFAULT_LIVE_ENDPOINT_LOG() { return ''; }

/* ---------- suivi des tests de la demo (opt-in, distinct de la telemetrie) ----------
   Contrairement a la telemetrie anonyme ci-dessus, le SUIVI de la demo enregistre
   le ticket teste et la reponse proposee, pour que l'auteur voie ce que les
   testeurs essaient. Reserve a une DEMO de recrutement (testeurs connus, pas de
   donnees reelles), envoye a un endpoint securise, et ANNONCE dans l'app. */
export function buildMonitorRecord(input) {
  input = input || {};
  return {
    mode: input.mode === 'live' ? 'live' : 'demo',
    model: String(input.model || ''),
    categorie: String(input.categorie || ''),
    gravite: String(input.gravite || ''),
    niveau_risque: String(input.niveau_risque || ''),
    validation_level: String(input.validationLevel || ''),
    reco_count: Number(input.recoCount || 0),
    locked: !!input.locked,
    ticket: String(input.ticket || ''),
    reponse: String(input.reponse || ''),
  };
}
export async function sendMonitor(record, opts) {
  opts = opts || {};
  if (!opts.enabled || !opts.endpoint) return; // opt-in strict
  const doFetch = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return;
  try {
    await doFetch(opts.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      keepalive: true, body: JSON.stringify(record),
    });
  } catch (_) { /* silencieux */ }
}

/**
 * Faut-il tenter une connexion live automatiquement au chargement ?
 * - En local (localhost) : oui, l'utilisateur presente sur sa machine.
 * - En public (heberge)  : JAMAIS, meme avec une URL memorisee. Le live est
 *   opt-in explicite (clic sur "Mode live"). Aucun octet ne part a l'ouverture.
 */
export function shouldAutoConnectOnLoad(env) {
  env = env || {};
  return env.isLocal === true;
}
