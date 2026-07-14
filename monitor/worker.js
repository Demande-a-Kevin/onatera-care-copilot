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
        const b = await req.json();
        const rec = {
          ts: new Date().toISOString(),
          mode: S(b.mode, 12), model: S(b.model, 40),
          categorie: S(b.categorie, 40), gravite: S(b.gravite, 20),
          niveau_risque: S(b.niveau_risque, 20), validation_level: S(b.validation_level, 30),
          reco_count: Number(b.reco_count || 0), locked: !!b.locked,
          ticket: S(b.ticket, 4000), reponse: S(b.reponse, 4000),
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
 pre{white-space:pre-wrap;font-family:inherit;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px;margin:0;max-height:260px;overflow:auto}
 .empty{color:var(--muted);text-align:center;padding:60px 10px}
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
async function load(){
  if(!tok()){ loginView(); return; }
  let d; try{ const r=await api('/api'); if(r.status===401){ loginView('Jeton refusé.'); return;} d=await r.json(); }
  catch(e){ loginView('Erreur réseau.'); return; }
  const recs=d.records||[];
  const rows=recs.map(e=>{
    const when=new Date(e.ts); const w=isNaN(when)?esc(e.ts):when.toLocaleString('fr-FR');
    const risk=(e.niveau_risque||'').toLowerCase();
    return '<div class="card"><div class="meta"><span class="when">'+w+'</span>'
      +pill(e.mode||'?',e.mode==='live'?'live':'demo')
      +(e.model?pill(e.model,'model'):'')
      +(e.categorie?pill(e.categorie):'')
      +(e.niveau_risque?pill('risque '+e.niveau_risque,'risk-'+risk):'')
      +(e.validation_level?pill('validation '+e.validation_level):'')
      +(e.reco_count?pill(e.reco_count+' reco'):'')
      +(e.locked?pill('verrouillé','locked'):'')
      +'</div><div class="cols"><div><h4>Ticket testé</h4><pre>'+(esc(e.ticket)||'<i>(vide)</i>')+'</pre></div>'
      +'<div><h4>Réponse proposée</h4><pre>'+(esc(e.reponse)||'<i>(vide)</i>')+'</pre></div></div></div>';
  }).join('');
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
