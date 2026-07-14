/* =========================================================================
   Onatera Copilot - Garde-fous deterministes (module testable).

   Ce module ne depend NI du navigateur NI du texte genere par le LLM. Il est
   importe a la fois par l'app (index.html, <script type="module">) et par les
   tests Node (node --test). Toute la logique metier bloquante vit ici, en dur,
   pour ne jamais etre confiee au modele.

   Principe de prudence (cf. brief section 4.1) : sur un cas sanitaire ambigu,
   SUR-escalader est le mode de defaillance sur. On combine donc les signaux
   emis par le triage LLM avec une detection lexicale independante du ticket.
   ========================================================================= */

/* ---------- 1. Detection lexicale deterministe ---------- */
// Familles de signaux durs reperees directement dans le texte du ticket.
const RE = {
  grossesse_allaitement: /enceinte|grossesse|enceint\w*|allait\w*|femme\s+enceinte|nourri(?:s|ce|r au sein)/i,
  mineur: /\bmineur\b|\benfant\b|\bb[eé]b[eé]\b|nourrisson|nouveau-?n[eé]|adolescent|\bado\b|coll[eé]gien|mon fils|ma fille|\b(?:1[0-7]|[1-9])\s*ans\b/i,
  personne_vulnerable: /personne\s+[aâ]g[eé]e|grand[- ]parent|vuln[eé]rable|d[eé]pendant|handicap/i,
  traitement: /traitement|m[eé]dicament\w*|\bpilule\b|contracept\w*|ordonnance|prescri\w*|anticoagulant|antid[eé]presseur|chimioth[eé]rapie|insuline|warfarine|sous\s+(?:pilule|traitement)/i,
  interaction: /interaction|annule\s+l['e ]effet|rend\w*\s+.{0,20}inefficace|inefficac\w*|incompatib\w*|contre[- ]indiqu\w*|potentialise/i,
  effet_indesirable: /effet\w*\s+ind[eé]sirable\w*|effet\w*\s+secondaire\w*|malaise|naus[eé]\w*|vomiss\w*|diarrh[eé]\w*|vertige\w*|allergi\w*|[eé]ruption|d[eé]mangeais\w*|palpitation\w*|confusion|hypercalc[eé]mie|intoxica\w*/i,
  surdosage: /surdos\w*|overdose|trop\s+de|exc[eè]s\b|surconsommation|cumul\w*|additionn\w*|plusieurs\s+sources|double\s+dose/i,
  hospitalisation: /hospitalis\w*|h[oô]pital|aux\s+urgences|service\s+des\s+urgences|r[eé]animation|soins\s+intensifs/i,
  atteinte_corporelle: /intoxication|empoisonn\w*|overdose|s[eé]quelle\w*|atteinte\s+corporelle|br[uû]lure\s+grave|handicap\s+grave/i,
  deces: /\bd[eé]c[eè]s\b|d[eé]c[eé]d[eé]\w*|\bd[eé]funt\w*|est\s+mort\b|sont\s+morts|entra[iî]n[eé]\s+la\s+mort|d[eé]c[eé]s/i,
  menace_dgccrf: /dgccrf|r[eé]pression\s+des\s+fraudes|signaler\w*.{0,30}(fraude|autorit|allegation|all[eé]gation)/i,
  menace_avocat: /avocat|tribunal|poursuite\w*\s+judiciaire|en\s+justice|mise\s+en\s+demeure|action\s+en\s+justice|porter\s+plainte/i,
  menace_media: /\bpresse\b|\bm[eé]dias?\b|journaliste|r[eé]seaux\s+sociaux|d[eé]noncer\s+publiquement|association\s+de\s+consommateurs|60\s*millions/i,
  pathologie_diagnostic: /diagnostic|pathologie|maladie|traiter\s+(?:un|mon|ma|le|la|des)\s+(?:probl[eè]me|trouble|cancer|maladie)|cancer|d[eé]pression|diab[eè]te|hypertension|prostate|tumeur|inflammation\w*\s+prostat/i,
};

// Correspondance signaux du triage LLM -> flags (le modele peut deja les avoir emis).
const TRIAGE_SIGNAL_MAP = {
  grossesse: 'grossesse_allaitement',
  hospitalisation: 'hospitalisation',
  atteinte_corporelle: 'atteinte_corporelle',
  deces: 'deces',
  menace_dgccrf: 'menace_dgccrf',
  menace_avocat: 'menace_avocat',
  menace_media: 'menace_media',
};

/**
 * Contexte de securite deterministe d'un ticket.
 * Combine le texte du ticket (regex) et les signaux du triage LLM.
 * @param {string} ticket - texte brut du ticket client
 * @param {object} triage - sortie de l'etape de triage (peut etre partielle)
 * @returns {object} flags booleens + escalade_sanitaire + signals[]
 */
export function computeSafetyContext(ticket, triage) {
  triage = triage || {};
  const text = String(ticket || '');
  const flags = {};
  for (const key of Object.keys(RE)) flags[key] = RE[key].test(text);

  // Signaux emis par le triage LLM (union prudente).
  const sig = Array.isArray(triage.signaux_escalade) ? triage.signaux_escalade : [];
  for (const s of sig) {
    const mapped = TRIAGE_SIGNAL_MAP[s];
    if (mapped) flags[mapped] = true;
  }
  if (triage.urgence_sanitaire === true) flags.urgence_sanitaire = true;

  // Un traitement en cours + un complement = interaction potentielle (prudence).
  if (flags.traitement && /complement|complément|prendre|cure|associer/i.test(text)) {
    flags.interaction = flags.interaction || false; // ne force pas, mais reste detectable
  }

  const escalade_sanitaire = !!(
    flags.hospitalisation || flags.atteinte_corporelle || flags.deces ||
    flags.surdosage || flags.interaction || flags.effet_indesirable ||
    (flags.grossesse_allaitement && (flags.traitement || flags.interaction)) ||
    triage.urgence_sanitaire === true
  );

  // Liste lisible des signaux actifs (pour l'affichage / la journalisation metadonnee).
  const signals = Object.keys(flags).filter(k => flags[k] === true);

  return { ...flags, urgence_sanitaire: !!flags.urgence_sanitaire, escalade_sanitaire, signals };
}

/* ---------- 2. Recommandations produits : suppression bloquante ---------- */
/**
 * Une recommandation produit est-elle autorisee ? (cf. brief 4.2)
 * Interdite des qu'un des criteres sensibles est present.
 */
export function productRecommendationsAllowed(safety, triage) {
  safety = safety || {};
  triage = triage || {};
  const cat = String(triage.categorie || '').toLowerCase();
  const grav = String(triage.gravite || '').toLowerCase();

  if (safety.grossesse_allaitement) return false;
  if (safety.mineur) return false;
  if (safety.traitement) return false;
  if (safety.effet_indesirable || safety.interaction || safety.surdosage || safety.hospitalisation) return false;
  if (grav === 'haute' || grav === 'critique') return false;
  if (cat && cat !== 'information_conseil') return false;
  // Reclamation portant sur la securite / conformite d'un produit.
  if (cat === 'securite_produit' || cat === 'reglementaire') return false;
  return true;
}

export const RECO_SUPPRESSED_MESSAGE =
  'Recommandations desactivees : situation necessitant une validation professionnelle ou interne';

/* ---------- 3. Niveau de validation deterministe (remplace le % de confiance) ---------- */
// 4 niveaux (brief 4.3). On calcule aussi la liste explicite des validateurs.
export const VALIDATION_META = {
  standard:            { label: 'Relecture conseiller',                       validators: ['Conseiller (relecture)'] },
  manager:             { label: 'Validation Responsable Client',              validators: ['Responsable Client'] },
  quality:             { label: 'Validation Qualite / Reglementaire',         validators: ['Qualite / Reglementaire'] },
  legal_nutrivigilance:{ label: 'Validation Responsable + Qualite/Nutrivigilance + Juridique',
                         validators: ['Responsable Client', 'Qualite / Nutrivigilance', 'Juridique'] },
};
const LEVEL_RANK = { standard: 0, manager: 1, quality: 2, legal_nutrivigilance: 3 };

/**
 * Niveau de validation requis + validateurs explicites + raisons.
 * @returns {{level:string, validators:string[], reasons:string[]}}
 */
export function computeValidationLevel(safety, triage, blocklistHits) {
  safety = safety || {};
  triage = triage || {};
  blocklistHits = blocklistHits || [];
  const cat = String(triage.categorie || '').toLowerCase();
  const grav = String(triage.gravite || '').toLowerCase();
  const reasons = [];
  const validators = new Set();
  let level = 'standard';
  const raise = (lv) => { if (LEVEL_RANK[lv] > LEVEL_RANK[level]) level = lv; };

  // --- legal_nutrivigilance (le plus haut) ---
  const responsabilite = blocklistHits.some(h => h.famille === 'responsabilite' || h.famille === 'causalite');
  if (safety.hospitalisation || safety.atteinte_corporelle || safety.deces || grav === 'critique') {
    raise('legal_nutrivigilance');
    reasons.push('Atteinte a la sante / dossier critique : validation Responsable + Qualite/Nutrivigilance + Juridique.');
  }
  if (safety.grossesse_allaitement && (safety.interaction || safety.traitement || safety.escalade_sanitaire)) {
    raise('legal_nutrivigilance');
    reasons.push('Grossesse avec risque sanitaire : validation renforcee.');
  }
  if (responsabilite) {
    raise('legal_nutrivigilance');
    reasons.push('Formulation de responsabilite / causalite detectee : validation juridique obligatoire.');
  }

  // --- quality ---
  if (cat === 'reglementaire' || cat === 'securite_produit' || safety.effet_indesirable ||
      safety.interaction || safety.surdosage || safety.pathologie_diagnostic) {
    raise('quality');
    reasons.push('Sujet reglementaire / securite produit / effet indesirable : validation Qualite.');
  }

  // --- manager ---
  if (grav === 'haute' || cat === 'commande') {
    raise('manager');
    reasons.push('Reclamation / criticite haute : validation Responsable Client.');
  }

  // Validateurs de base du niveau retenu.
  VALIDATION_META[level].validators.forEach(v => validators.add(v));

  // Validateurs additifs selon les signaux specifiques.
  if (safety.menace_dgccrf || safety.menace_avocat || safety.menace_media) {
    validators.add('Juridique');
    validators.add('Qualite / Reglementaire');
    reasons.push('Menace externe (DGCCRF / avocat / media) : validation Qualite et Juridique.');
    raise('quality');
  }
  if (safety.hospitalisation || safety.atteinte_corporelle || safety.deces || safety.effet_indesirable) {
    validators.add('Nutrivigilance / ANSES');
  }

  return { level, validators: [...validators], reasons };
}

/* ---------- 4. Formulations a risque (familles etendues, brief 4.5) ---------- */
const RISKY_FORMULATIONS = [
  // causalite
  { famille: 'causalite', re: /a\s+caus[eé]|a\s+provoqu[eé]|est\s+[aà]\s+l['e ]origine|explique\s+votre\s+[eé]tat|a\s+entra[iî]n[eé]|est\s+responsable\s+de\s+votre/i },
  // responsabilite / faute
  { famille: 'responsabilite', re: /nous\s+sommes\s+responsables|notre\s+faute|notre\s+erreur|reconnaissons\s+(?:notre\s+responsabilit|etre\s+responsable|être\s+responsable)|responsabilit[eé]\s+d['e ]onatera/i },
  // diagnostic / prescription
  { famille: 'diagnostic_prescription', re: /vous\s+souffrez\s+de|arr[eê]tez\s+votre\s+traitement|prenez\s+(?:plut[oô]t\s+)?(?:notre|ce|le|la|du|des)\b|je\s+vous\s+prescris|vous\s+devez\s+prendre/i },
  // engagement financier non valide
  { famille: 'engagement_financier', re: /nous\s+vous\s+rembours\w*|nous\s+vous\s+offrons\s+\d|un\s+d[eé]dommagement\s+de\s+\d|un\s+geste\s+commercial\s+de\s+\d|\d+\s*(?:euros?|€)\s+de\s+(?:remboursement|d[eé]dommagement)/i },
];

/**
 * Repere les formulations a risque dans un texte genere.
 * @returns {Array<{famille:string, match:string}>}
 */
export function scanRiskyFormulations(text) {
  const t = String(text || '');
  const hits = [];
  for (const f of RISKY_FORMULATIONS) {
    const m = t.match(f.re);
    if (m) hits.push({ famille: f.famille, match: m[0] });
  }
  return hits;
}

/* ---------- 5. Fail-closed : verrouillage de la copie (brief 4.4) ---------- */
/**
 * La reponse doit-elle etre verrouillee (copie interdite) ?
 * Vrai pour tout dossier critique ou de niveau legal_nutrivigilance.
 */
export function isCopyLocked(niveauRisque, validation) {
  const lvl = validation && validation.level;
  return String(niveauRisque || '').toLowerCase() === 'critique' || lvl === 'legal_nutrivigilance';
}

/* ---------- honnetete du mode demo (brief 5) ---------- */
export const FREE_TICKET_DEMO_NOTICE =
  'Ticket libre en mode demo : les resultats affiches illustrent un cas pre-calcule proche et ' +
  'ne constituent PAS l\'analyse reelle du texte saisi. Passez en mode live pour analyser ce texte.';

/**
 * Un ticket saisi librement (sans exemple connu correspondant) est-il illustre
 * par une sortie pre-calculee ? Si oui, l'UI doit l'annoncer explicitement.
 */
export function isFreeTicketDemo(exId, hasDemoForEx) {
  return !(exId && hasDemoForEx);
}

/* ---------- utilitaires de coherence de niveau de risque ---------- */
const RISK_RANK = { faible: 0, modere: 1, eleve: 2, critique: 3 };
const GRAVITE_TO_RISK = { basse: 'faible', moyenne: 'modere', haute: 'eleve', critique: 'critique' };

// Nettoie une eventuelle fuite de raisonnement / notes / balises apres le mail.
export function sanitizeReply(t) {
  if (!t) return '';
  t = String(t).replace(/\r/g, '');
  t = t.replace(/\n?\s*(thought[_ ]?process|thinking|<\/?think>|analysis\s*:|reasoning\s*:|note[s]? interne\s*:|explication interne\s*:|```)[\s\S]*$/i, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- 6. Orchestrateur deterministe ---------- */
/**
 * Applique tous les garde-fous en post-traitement (mute `red`).
 * @returns {object} synthese : safety, validation, blocklistHits, locked,
 *                   recoSuppressed, recoSuppressReason, forcedTags, notes.
 */
export function applyGuardrails(triage, red, ticket) {
  triage = triage || {};
  red = red || {};
  const notes = [];

  // 0. nettoyage de la reponse
  red.reponse_client = sanitizeReply(red.reponse_client);

  // 1. contexte de securite deterministe
  const safety = computeSafetyContext(ticket, triage);

  // 2. escalade forcee (atteinte a la sante) -> niveau critique + escalades
  const forcedTags = [];
  const forced = safety.hospitalisation || safety.atteinte_corporelle || safety.deces;
  if (forced) {
    red.niveau_risque = 'critique';
    const must = ['juridique', 'direction', 'nutrivigilance_anses'];
    red.escalade_requise = red.escalade_requise || [];
    must.forEach(m => { if (!red.escalade_requise.includes(m)) { red.escalade_requise.push(m); forcedTags.push(m); } });
    notes.push('Escalade forcee (hospitalisation / atteinte corporelle / deces) : niveau critique + juridique/direction/nutrivigilance ANSES.');

    const FORCED_ACTIONS = {
      juridique: { service: 'Juridique', action: "Prendre en charge le dossier (risque sanitaire avec atteinte corporelle) et valider la reponse avant tout envoi", priorite: 'haute', delai: '24h' },
      direction: { service: 'Direction', action: "Etre informee du dossier sensible et valider la reponse avant envoi", priorite: 'haute', delai: '24h' },
      nutrivigilance_anses: { service: 'Nutrivigilance / ANSES', action: "Evaluer une declaration de nutrivigilance a l'ANSES (effet indesirable grave suspecte)", priorite: 'haute', delai: '48h' },
    };
    red.actions_internes = red.actions_internes || [];
    must.slice().reverse().forEach(m => {
      const a = FORCED_ACTIONS[m];
      if (a && !red.actions_internes.some(x => (x.service || '').toLowerCase() === a.service.toLowerCase()))
        red.actions_internes.unshift(a);
    });
  }

  // 3. coherence : niveau de risque >= criticite du triage
  const floor = GRAVITE_TO_RISK[String(triage.gravite || '').toLowerCase()];
  if (floor && (RISK_RANK[floor] > (RISK_RANK[red.niveau_risque] || 0))) {
    red.niveau_risque = floor;
    notes.push('Niveau de risque aligne sur la criticite du triage (' + floor + ').');
  }
  if (safety.urgence_sanitaire && (RISK_RANK[red.niveau_risque] || 0) < RISK_RANK.eleve) {
    red.niveau_risque = 'eleve';
    notes.push('Urgence sanitaire : niveau de risque releve a "eleve".');
  }

  // 4. formulations a risque (familles etendues)
  const blocklistHits = scanRiskyFormulations(red.reponse_client || '');

  // 5. niveau de validation deterministe
  const validation = computeValidationLevel(safety, triage, blocklistHits);

  // 6. suppression bloquante des recommandations produits
  let recoSuppressed = false, recoSuppressReason = '';
  if (!productRecommendationsAllowed(safety, triage)) {
    if ((red.recommandations_produits || []).length) recoSuppressed = true;
    red.recommandations_produits = [];
    recoSuppressReason = RECO_SUPPRESSED_MESSAGE;
  }

  // 7. fail-closed : verrouillage de la copie
  //    critique / legal_nutrivigilance, OU formulation de responsabilite sur cas sensible.
  const responsabiliteHit = blocklistHits.some(h => h.famille === 'responsabilite' || h.famille === 'causalite');
  let locked = isCopyLocked(red.niveau_risque, validation);
  if (responsabiliteHit && safety.escalade_sanitaire) locked = true;

  return {
    safety, validation, blocklistHits, forced, forcedTags, notes,
    recoSuppressed, recoSuppressReason, locked,
  };
}
