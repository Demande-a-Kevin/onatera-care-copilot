// Tests des garde-fous deterministes (aucune dependance : node --test).
// Couvrent les cas obligatoires du brief de securisation (section 6, points 1-6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSafetyContext,
  productRecommendationsAllowed,
  computeValidationLevel,
  scanRiskyFormulations,
  isCopyLocked,
  applyGuardrails,
  isFreeTicketDemo,
  FREE_TICKET_DEMO_NOTICE,
} from '../js/safety.js';

/* ---------- honnetete du mode demo (ticket libre) ---------- */

test('un ticket libre en demo est signale comme illustration pre-calculee', () => {
  assert.equal(isFreeTicketDemo('', false), true);       // pas d'exemple choisi
  assert.equal(isFreeTicketDemo('4471', true), false);   // exemple connu -> vraie sortie
  assert.ok(/illustration|pr[eé]-?calcul/i.test(FREE_TICKET_DEMO_NOTICE));
});

/* ---------- computeSafetyContext ---------- */

test('detecte une grossesse dans le texte, independamment du triage', () => {
  const s = computeSafetyContext('Je viens d’apprendre que je suis enceinte.', {});
  assert.equal(s.grossesse_allaitement, true);
});

test('detecte un traitement medicamenteux en cours', () => {
  const s = computeSafetyContext('Je prends la pilule depuis des annees.', {});
  assert.equal(s.traitement, true);
});

test('detecte une hospitalisation meme si le triage LLM l’a omise', () => {
  const s = computeSafetyContext('Il a ete hospitalise pour une hypercalcemie severe.', { signaux_escalade: [] });
  assert.equal(s.hospitalisation, true);
});

test('une simple demande logistique ne declenche aucun signal sanitaire', () => {
  const s = computeSafetyContext('Ou en est ma commande ? Le colis a du retard.', { categorie: 'livraison' });
  assert.equal(s.grossesse_allaitement, false);
  assert.equal(s.traitement, false);
  assert.equal(s.hospitalisation, false);
  assert.equal(s.effet_indesirable, false);
  assert.equal(s.escalade_sanitaire, false);
});

test('herite aussi des signaux emis par le triage LLM', () => {
  const s = computeSafetyContext('texte neutre', { signaux_escalade: ['grossesse', 'deces'] });
  assert.equal(s.grossesse_allaitement, true);
  assert.equal(s.deces, true);
});

/* ---------- recommandations produits (suppression bloquante) ---------- */

test('grossesse + complement => aucune recommandation autorisee', () => {
  const triage = { categorie: 'information_conseil', gravite: 'moyenne' };
  const safety = computeSafetyContext('Je suis enceinte, puis-je prendre du Magnesium Bisglycinate ?', triage);
  assert.equal(productRecommendationsAllowed(safety, triage), false);
});

test('traitement medicamenteux en cours => aucune recommandation autorisee', () => {
  const triage = { categorie: 'information_conseil', gravite: 'basse' };
  const safety = computeSafetyContext('Je prends un anticoagulant, que me conseillez-vous ?', triage);
  assert.equal(productRecommendationsAllowed(safety, triage), false);
});

test('demande de conseil simple => recommandations autorisees', () => {
  const triage = { categorie: 'information_conseil', gravite: 'basse' };
  const safety = computeSafetyContext('Je suis fatiguee et stressee, que me conseillez-vous ?', triage);
  assert.equal(productRecommendationsAllowed(safety, triage), true);
});

test('categorie non information_conseil => aucune recommandation', () => {
  const triage = { categorie: 'reglementaire', gravite: 'haute' };
  const safety = computeSafetyContext('Vos allegations sont interdites.', triage);
  assert.equal(productRecommendationsAllowed(safety, triage), false);
});

test('criticite haute => aucune recommandation meme en information_conseil', () => {
  const triage = { categorie: 'information_conseil', gravite: 'haute' };
  const safety = computeSafetyContext('question produit', triage);
  assert.equal(productRecommendationsAllowed(safety, triage), false);
});

/* ---------- niveau de validation (deterministe, remplace le % de confiance) ---------- */

test('hospitalisation => niveau de validation legal_nutrivigilance', () => {
  const triage = { categorie: 'risque_sanitaire', gravite: 'critique' };
  const safety = computeSafetyContext('Mon pere a ete hospitalise pour hypercalcemie.', triage);
  const v = computeValidationLevel(safety, triage, []);
  assert.equal(v.level, 'legal_nutrivigilance');
});

test('menace DGCCRF => validation Qualite ET Juridique', () => {
  const triage = { categorie: 'reglementaire', gravite: 'haute' };
  const safety = computeSafetyContext('Je signalerai vos allegations a la DGCCRF.', triage);
  const v = computeValidationLevel(safety, triage, []);
  assert.ok(v.validators.some(x => /qualit/i.test(x)), 'Qualite requise');
  assert.ok(v.validators.some(x => /juridique/i.test(x)), 'Juridique requis');
});

test('grossesse (meme sur un simple conseil) => validation au moins manager', () => {
  const triage = { categorie: 'information_conseil', gravite: 'basse' };
  const safety = computeSafetyContext('Je suis enceinte, quel complément pour la fatigue ?', triage);
  const v = computeValidationLevel(safety, triage, []);
  assert.ok(['manager', 'quality', 'legal_nutrivigilance'].includes(v.level), 'niveau > standard, obtenu: ' + v.level);
});

test('demande logistique simple => validation standard', () => {
  const triage = { categorie: 'livraison', gravite: 'basse' };
  const safety = computeSafetyContext('Mon colis a du retard, ou en est-il ?', triage);
  const v = computeValidationLevel(safety, triage, []);
  assert.equal(v.level, 'standard');
});

/* ---------- formulations a risque (familles etendues) ---------- */

test('detecte une formulation causale generee', () => {
  const hits = scanRiskyFormulations('Nous reconnaissons que notre produit a provoque votre hospitalisation.');
  assert.ok(hits.length > 0);
  assert.ok(hits.some(h => h.famille === 'causalite' || h.famille === 'responsabilite'));
});

test('detecte une prescription / injonction medicale', () => {
  const hits = scanRiskyFormulations('Arretez votre traitement et prenez plutot notre complement.');
  assert.ok(hits.some(h => h.famille === 'diagnostic_prescription'));
});

test('un mail neutre ne declenche aucune formulation a risque', () => {
  const hits = scanRiskyFormulations('Bonjour Madame, nous avons bien recu votre message et revenons vers vous.');
  assert.equal(hits.length, 0);
});

/* ---------- fail-closed : verrouillage de la copie ---------- */

test('un dossier critique verrouille la copie', () => {
  assert.equal(isCopyLocked('critique', { level: 'quality' }), true);
});

test('un niveau legal_nutrivigilance verrouille la copie', () => {
  assert.equal(isCopyLocked('eleve', { level: 'legal_nutrivigilance' }), true);
});

test('un dossier standard modere ne verrouille pas la copie', () => {
  assert.equal(isCopyLocked('modere', { level: 'standard' }), false);
});

/* ---------- applyGuardrails : orchestration deterministe ---------- */

test('hospitalisation => niveau force a critique + copie verrouillee', () => {
  const triage = { categorie: 'risque_sanitaire', gravite: 'critique', urgence_sanitaire: true, signaux_escalade: [] };
  const red = {
    niveau_risque: 'modere',
    reponse_client: 'Bonjour, nous revenons vers vous.',
    recommandations_produits: [{ nom: 'X', pourquoi: 'y', points_de_vigilance: 'z' }],
    actions_internes: [], escalade_requise: [], sources_utilisees: [],
  };
  const g = applyGuardrails(triage, red, 'Mon pere a ete hospitalise pour hypercalcemie apres vos vitamines.');
  assert.equal(red.niveau_risque, 'critique');
  assert.equal(g.locked, true);
  assert.equal(g.validation.level, 'legal_nutrivigilance');
  assert.deepEqual(red.recommandations_produits, []); // suppression sur cas sensible
});

test('formulation causale generee => verrouillage', () => {
  const triage = { categorie: 'risque_sanitaire', gravite: 'haute', urgence_sanitaire: true, signaux_escalade: [] };
  const red = {
    niveau_risque: 'eleve',
    reponse_client: 'Nous reconnaissons que notre produit a cause votre malaise.',
    actions_internes: [], escalade_requise: [], sources_utilisees: [], recommandations_produits: [],
  };
  const g = applyGuardrails(triage, red, 'Votre produit m’a rendu malade.');
  assert.ok(g.blocklistHits.length > 0);
  assert.equal(g.locked, true);
});

test('ticket enceinte + magnesium => aucune recommandation apres post-traitement', () => {
  const triage = { categorie: 'information_conseil', gravite: 'moyenne', urgence_sanitaire: false, signaux_escalade: [] };
  const red = {
    niveau_risque: 'faible',
    reponse_client: 'Le Magnesium Bisglycinate est disponible.',
    recommandations_produits: [{ nom: 'Magnesium Bisglycinate', prix: '12,90 EUR', pourquoi: 'fatigue', points_de_vigilance: 'aucune' }],
    actions_internes: [], escalade_requise: [], sources_utilisees: [],
  };
  const g = applyGuardrails(triage, red, 'Je suis enceinte, le Magnesium Bisglycinate est-il compatible ?');
  assert.deepEqual(red.recommandations_produits, []);
  assert.ok(g.recoSuppressed);
});
