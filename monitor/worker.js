/* =========================================================================
   Onatera Copilot - Page de suivi des tests de la demo (SECURISEE).

   Corrige les problemes de l'ancien worker de logs :
   - jeton d'admin JAMAIS dans l'URL : saisi dans un formulaire, envoye en
     en-tete Authorization (memorise en sessionStorage cote navigateur) ;
   - CORS verrouille sur les origines de la demo (jamais "*") ;
   - stockage PAR ENREGISTREMENT (une cle KV par test, pas de lecture+reecriture
     d'une cle unique -> pas de course a l'ecriture) ;
   - AUCUNE IP, ville ou pays stockee ;
   - retention courte (TTL) affichee ; limitation de debit ; noindex.

   Perimetre : demo de recrutement, testeurs connus. Les tickets de test saisis
   sont enregistres pour le suivi (l'app l'affiche clairement). Ne pas y saisir
   de donnees personnelles reelles.

   Secret :  wrangler secret put MONITOR_TOKEN
   ========================================================================= */

const ALLOWED_ORIGINS = [
  'https://onatera-copilot.pages.dev',
  'https://demande-a-kevin.github.io',
];
const PREFIX = 'log:';
const RETENTION_DAYS = 14;
const MAX_VIEW = 300;
const RL_MAX = 60, RL_WINDOW = 300; // 60 ecritures / IP / 5 min

const S = (v, n) => String(v == null ? '' : v).slice(0, n);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function corsFor(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': ok || 'null',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  };
}
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function bearer(req) { return (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''); }
async function rateLimited(req) {
  try {
    const ip = req.headers.get('cf-connecting-ip') || '0';
    const bucket = Math.floor(Date.now() / 1000 / RL_WINDOW);
    const key = new Request('https://rl.local/mon/' + bucket + '/' + ip);
    const cache = caches.default;
    const hit = await cache.match(key);
    let n = hit ? (Number(await hit.text()) || 0) : 0;
    n += 1;
    await cache.put(key, new Response(String(n), { headers: { 'Cache-Control': 'max-age=' + RL_WINDOW } }));
    return n > RL_MAX;
  } catch (_) { return false; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = corsFor(origin);

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // --- enregistrement d'un test (depuis l'app) ---
    if (req.method === 'POST' && url.pathname === '/log') {
      if (origin && !ALLOWED_ORIGINS.includes(origin))
        return new Response(JSON.stringify({ ok: false, error: 'origine' }), { status: 403, headers: { ...cors, 'content-type': 'application/json' } });
      if (await rateLimited(req)) return new Response('rate', { status: 429, headers: cors });
      try {
        const raw = await req.text();
        if (raw.length > 80 * 1024) return new Response(JSON.stringify({ ok: false, error: 'trop volumineux' }), { status: 413, headers: { ...cors, 'content-type': 'application/json' } });
        const b = JSON.parse(raw);
        const arr = (v, n) => Array.isArray(v) ? v.slice(0, n) : [];
        const triage = b.triage && typeof b.triage === 'object' ? b.triage : null;
        const red = b.redaction && typeof b.redaction === 'object' ? b.redaction : null;
        const rec = {
          ts: new Date().toISOString(),
          mode: S(b.mode, 12), model: S(b.model, 40),
          ticket: S(b.ticket, 6000),
          triage,                                  // objet triage complet
          retrieved: arr(b.retrieved, 12),         // recherche documentaire (fiches + score)
          validation: b.validation || null,        // { level, validators[], reasons[] }
          reco_suppressed: !!b.reco_suppressed,
          reco_suppress_reason: S(b.reco_suppress_reason, 200),
          redaction: red,                          // reponse, actions_internes, recommandations_produits, sources_utilisees...
          // champs plats (pastilles)
          categorie: S((triage && triage.categorie) || b.categorie, 40),
          gravite: S((triage && triage.gravite) || b.gravite, 20),
          niveau_risque: S((red && red.niveau_risque) || b.niveau_risque, 20),
          validation_level: S((b.validation && b.validation.level) || b.validation_level, 30),
          reco_count: Number(b.reco_count || (red && (red.recommandations_produits || []).length) || 0),
          locked: !!b.locked,
        };
        const key = PREFIX + rec.ts + '-' + Math.random().toString(36).slice(2, 8);
        await env.MONITOR.put(key, JSON.stringify(rec), { expirationTtl: RETENTION_DAYS * 86400 });
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'content-type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { ...cors, 'content-type': 'application/json' } });
      }
    }

    // --- page admin (formulaire de jeton, jamais dans l'URL) ---
    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } });
    }

    // --- API admin : jeton en en-tete Authorization (jamais en query string) ---
    if (url.pathname === '/api' || url.pathname === '/flush') {
      if (!env.MONITOR_TOKEN || !safeEqual(bearer(req), env.MONITOR_TOKEN))
        return new Response(JSON.stringify({ ok: false, error: 'auth' }), { status: 401, headers: { 'content-type': 'application/json' } });

      if (url.pathname === '/flush' && req.method === 'POST') {
        const list = await env.MONITOR.list({ prefix: PREFIX });
        await Promise.all(list.keys.map((k) => env.MONITOR.delete(k.name)));
        return new Response(JSON.stringify({ ok: true, deleted: list.keys.length }), { headers: { 'content-type': 'application/json' } });
      }

      const list = await env.MONITOR.list({ prefix: PREFIX, limit: 1000 });
      const keys = list.keys.map((k) => k.name).sort().reverse().slice(0, MAX_VIEW);
      const recs = await Promise.all(keys.map(async (k) => { try { return JSON.parse(await env.MONITOR.get(k)); } catch (_) { return null; } }));
      return new Response(JSON.stringify({ ok: true, retention_days: RETENTION_DAYS, count: recs.filter(Boolean).length, records: recs.filter(Boolean) }),
        { headers: { 'content-type': 'application/json' } });
    }

    return new Response('Onatera Copilot - suivi des tests', { status: 404 });
  },
};

const ADMIN_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Suivi des tests - Onatera Copilot</title>
<style>
 :root{--green:#2f6b4f;--green-dark:#1e4d38;--green-soft:#e5efe8;--cream:#f7f3ea;--ink:#20261f;--muted:#6b7469;--line:#dfe4d8;--red:#b5352b;--amber:#8a5a00;--blue:#2a5b7a}
 *{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--cream);color:var(--ink)}
 header{background:var(--green-dark);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
 header h1{font-size:16px;margin:0}header .sub{font-size:12px;color:#cfe0d6}
 header .count{margin-left:auto;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:4px 12px;font-size:13px}
 header button{background:#fff;color:var(--green-dark);border:0;border-radius:8px;padding:7px 12px;font-weight:600;cursor:pointer;margin-left:8px}
 main{max-width:1080px;margin:0 auto;padding:18px}
 .login{max-width:420px;margin:60px auto;background:#fffdf8;border:1px solid var(--line);border-radius:12px;padding:22px}
 .login h2{margin:0 0 6px;font-size:18px}.login p{color:var(--muted);font-size:13px;margin:0 0 14px}
 .login input{width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;font:inherit;margin-bottom:10px}
 .login button{width:100%;background:var(--green);color:#fff;border:0;border-radius:9px;padding:11px;font-weight:700;cursor:pointer}
 .err{color:var(--red);font-size:13px;margin-top:8px}
 .note{font-size:12px;color:var(--muted);margin:0 0 12px}
 .card{background:#fffdf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px}
 .meta{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-bottom:10px}
 .when{font-weight:700;font-size:13px}
 .pill{font-size:12px;background:var(--green-soft);border:1px solid #cadfd0;color:var(--green-dark);border-radius:999px;padding:2px 9px}
 .pill.live{background:#dff0e6;font-weight:700}.pill.demo{background:#fcf2da;border-color:#ecd9a6;color:var(--amber)}
 .pill.model{background:#eef2f6;border-color:#d6e0ea;color:var(--blue)}
 .pill.locked{background:#fbe9e7;border-color:#eec3bd;color:var(--red);font-weight:700}
 .pill.risk-critique,.pill.risk-eleve{background:#fbe9e7;border-color:#eec3bd;color:var(--red)}
 .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:720px){.cols{grid-template-columns:1fr}}
 h4{margin:0 0 5px;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
 pre{white-space:pre-wrap;font-family:inherit;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px;margin:0;max-height:320px;overflow:auto}
 .empty{color:var(--muted);text-align:center;padding:60px 10px}
 .blk{margin-top:12px}
 .mut{color:var(--muted)}
 .kv{background:#fff;border:1px solid var(--line);border-radius:8px;padding:4px 10px}
 .kvr{display:flex;gap:10px;padding:5px 0;border-bottom:1px solid #f0efe8;font-size:13px}
 .kvr:last-child{border-bottom:0}
 .kvl{flex:0 0 160px;color:var(--muted);font-weight:600}
 .kvv{flex:1}
 .src{display:flex;align-items:center;gap:8px;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin-top:6px}
 .src .score{margin-left:auto;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
 .pill.vlvl{background:#eef2f6;border-color:#d6e0ea;color:var(--blue);font-weight:700}
 .vwrap{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
 .atbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
 .atbl th,.atbl td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top}
 .atbl th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
 .reco{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:6px;background:#fff;font-size:13px}
 .reco .prix{font-size:12px;font-weight:700;color:var(--green-dark);background:var(--green-soft);border:1px solid #cadfd0;border-radius:999px;padding:1px 8px}
 .reco .vig{margin-top:5px;font-size:12.5px;background:#fcf2da;border:1px solid #ecd9a6;color:var(--amber);border-radius:6px;padding:5px 8px}
 .off{background:#fcf2da;border:1px dashed #ecd9a6;color:var(--amber);border-radius:8px;padding:9px 11px;font-size:13px}
 .dl{margin-left:auto;background:#fff;border:1px solid var(--line);color:var(--green-dark);border-radius:8px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer}
</style></head><body>
<div id="app"></div>
<script>
const K='onatera_monitor_token';
function tok(){ try{return sessionStorage.getItem(K)||''}catch(_){return ''} }
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function loginView(msg){
  document.getElementById('app').innerHTML='<div class="login"><h2>Suivi des tests</h2>'
   +'<p>Saisissez le jeton d\\'accès (jamais dans l\\'URL).</p>'
   +'<input id="t" type="password" placeholder="Jeton d\\'accès" autocomplete="off">'
   +'<button onclick="doLogin()">Ouvrir</button>'+(msg?'<div class="err">'+esc(msg)+'</div>':'')+'</div>';
  const i=document.getElementById('t'); i.focus(); i.addEventListener('keydown',e=>{if(e.key==="Enter")doLogin()});
}
function doLogin(){ try{sessionStorage.setItem(K,document.getElementById('t').value.trim())}catch(_){}; load(); }
async function api(path,opts){ return fetch(path,Object.assign({headers:{'Authorization':'Bearer '+tok()}},opts||{})); }
async function flush(){ if(!confirm('Vider tout l\\'historique des tests ?'))return; await api('/flush',{method:'POST'}); load(); }
function pill(t,c){return '<span class="pill '+(c||'')+'">'+esc(t)+'</span>'}
function kv(label,val){ if(val==null||val==='')return ''; if(Array.isArray(val)){ if(!val.length)return ''; val=val.join(', '); } return '<div class="kvr"><span class="kvl">'+esc(label)+'</span><span class="kvv">'+esc(val)+'</span></div>'; }
function renderTriage(t){
  if(!t) return '';
  return '<div class="blk"><h4>Triage (complet)</h4><div class="kv">'
    + kv('Résumé', t.resume_1_phrase)
    + kv('Catégorie', t.categorie)
    + kv('Criticité', t.gravite)
    + kv('Urgence sanitaire', t.urgence_sanitaire===true?'oui':(t.urgence_sanitaire===false?'non':''))
    + kv('État émotionnel', t.etat_emotionnel)
    + kv('Produits cités', t.produits_cites)
    + kv('Actifs concernés', t.actifs_concernes)
    + kv('Besoins', t.besoins)
    + kv('Signaux d’escalade', t.signaux_escalade)
    + kv('Faits allégués', t.faits_allegues)
    + kv('Demandes explicites', t.demandes_explicites)
    + '</div></div>';
}
function renderRetrieved(list){
  if(!Array.isArray(list)||!list.length) return '';
  return '<div class="blk"><h4>Recherche documentaire (fiches utilisées)</h4>'
    + list.map(h=>'<div class="src"><b>'+esc(h.nom||h.id)+'</b> <span class="mut">'+esc(h.id||'')+(h.type?' · '+esc(h.type):'')+'</span><span class="score">score '+esc(h.score)+'</span></div>').join('')
    + '</div>';
}
function renderValidation(v){
  if(!v) return '';
  return '<div class="blk"><h4>Niveau de validation requis</h4>'
    + '<div><span class="pill vlvl">'+esc(v.level||'')+'</span></div>'
    + (Array.isArray(v.validators)&&v.validators.length?'<div class="vwrap">'+v.validators.map(x=>'<span class="pill">'+esc(x)+'</span>').join('')+'</div>':'')
    + (Array.isArray(v.reasons)&&v.reasons.length?'<div class="mut" style="margin-top:6px">'+esc(v.reasons.join(' '))+'</div>':'')
    + '</div>';
}
function renderActions(list){
  if(!Array.isArray(list)||!list.length) return '';
  return '<div class="blk"><h4>Actions internes à déclencher</h4><table class="atbl"><thead><tr><th>À qui</th><th>Action</th><th>Prio.</th><th>Délai</th></tr></thead><tbody>'
    + list.map(a=>'<tr><td>'+esc(a.service)+'</td><td>'+esc(a.action)+'</td><td>'+esc(a.priorite)+'</td><td>'+esc(a.delai)+'</td></tr>').join('')
    + '</tbody></table></div>';
}
function renderRecos(e){
  if(e.reco_suppressed) return '<div class="blk"><h4>Recommandations produits</h4><div class="off">🔒 '+esc(e.reco_suppress_reason||'Recommandations désactivées')+'</div></div>';
  const list=(e.redaction&&e.redaction.recommandations_produits)||[];
  if(!list.length) return '';
  return '<div class="blk"><h4>Recommandations produits</h4>'
    + list.map(r=>'<div class="reco"><b>'+esc(r.nom)+'</b>'+(r.prix?' <span class="prix">'+esc(r.prix)+'</span>':'')
        +(r.pourquoi?'<div>'+esc(r.pourquoi)+'</div>':'')
        +(r.points_de_vigilance?'<div class="vig">⚠️ '+esc(r.points_de_vigilance)+'</div>':'')+'</div>').join('')
    + '</div>';
}
function renderCard(e,i){
  const when=new Date(e.ts); const w=isNaN(when)?esc(e.ts):when.toLocaleString('fr-FR');
  const risk=(e.niveau_risque||'').toLowerCase();
  const red=e.redaction||{};
  const sources=(red.sources_utilisees||[]);
  const checks=(red.points_a_valider_par_un_humain||[]);
  return '<div class="card"><div class="meta"><span class="when">'+w+'</span>'
    +pill(e.mode||'?',e.mode==='live'?'live':'demo')
    +(e.model?pill(e.model,'model'):'')
    +(e.categorie?pill(e.categorie):'')
    +(e.niveau_risque?pill('risque '+e.niveau_risque,'risk-'+risk):'')
    +(e.validation_level?pill('validation '+e.validation_level):'')
    +(e.reco_count?pill(e.reco_count+' reco'):'')
    +(e.locked?pill('verrouillé','locked'):'')
    +'<button class="dl" onclick="dlJson('+i+')">Télécharger le JSON</button>'
    +'</div>'
    +'<div class="blk"><h4>Ticket testé</h4><pre>'+(esc(e.ticket)||'<i>(vide)</i>')+'</pre></div>'
    +renderTriage(e.triage)
    +renderRetrieved(e.retrieved)
    +renderValidation(e.validation)
    +renderActions(red.actions_internes)
    +renderRecos(e)
    +'<div class="blk"><h4>Réponse proposée</h4><pre>'+(esc(red.reponse_client)||'<i>(vide)</i>')+'</pre></div>'
    +(sources.length?'<div class="blk"><h4>Sources utilisées</h4>'+sources.map(s=>'<span class="pill">'+esc(s)+'</span>').join(' ')+'</div>':'')
    +(checks.length?'<div class="blk"><h4>Points à valider par un humain</h4><ul>'+checks.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></div>':'')
    +'</div>';
}
function dlJson(i){
  try{
    const rec=(window.__MON||[])[i]; if(!rec)return;
    const blob=new Blob([JSON.stringify(rec,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='analyse-'+(rec.ts||'').replace(/[:.]/g,'-')+'.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }catch(_){}
}
async function load(){
  if(!tok()){ loginView(); return; }
  let d; try{ const r=await api('/api'); if(r.status===401){ loginView('Jeton refusé.'); return;} d=await r.json(); }
  catch(e){ loginView('Erreur réseau.'); return; }
  const recs=d.records||[]; window.__MON=recs;
  const rows=recs.map((e,i)=>renderCard(e,i)).join('');
  document.getElementById('app').innerHTML=
   '<header><div><h1>Suivi des tests - Onatera Copilot</h1><div class="sub">Démo de recrutement - tickets de test, rétention '+(d.retention_days||14)+' j</div></div>'
   +'<span class="count">'+(d.count||0)+' test'+((d.count||0)>1?'s':'')+'</span>'
   +'<button onclick="load()">Rafraîchir</button>'
   +'<button onclick="flush()" style="background:#fbe9e7;color:#b5352b">Vider</button>'
   +'<button onclick="(function(){try{sessionStorage.removeItem(\\'onatera_monitor_token\\')}catch(_){}; location.reload()})()">Déconnexion</button></header>'
   +'<main><p class="note">Aucune IP ni localisation n\\'est enregistrée. Rétention automatique '+(d.retention_days||14)+' jours. Page non indexée.</p>'
   +(recs.length?rows:'<div class="empty">Aucun test enregistré pour le moment.</div>')+'</main>';
}
load();
</script></body></html>`;
