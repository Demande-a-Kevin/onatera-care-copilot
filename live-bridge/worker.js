/* =========================================================================
   Onatera Copilot - Pont live SECURISE (Worker Cloudflare).

   Remplace l'exposition directe d'Ollama sur Internet. Ce Worker est le SEUL
   point public ; il ne relaie vers le moteur Ollama (via le tunnel) qu'apres :
     1. origine autorisee (CORS verrouille sur les URL de la demo, jamais *) ;
     2. jeton d'acces valide (en-tete X-Onatera-Live == secret DEMO_TOKEN) ;
     3. route autorisee (uniquement /api/tags et /api/chat) ;
     4. modele autorise (liste blanche) et taille de requete bornee ;
     5. limitation de debit par IP.
   Il ajoute un secret d'origine (ORIGIN_SECRET) que le proxy local exige :
   ainsi le hostname du tunnel n'est jamais un Ollama ouvert, meme s'il fuite.

   Secrets (jamais commites) :
     wrangler secret put DEMO_TOKEN      # jeton communique aux testeurs Onatera
     wrangler secret put ORIGIN_SECRET   # partage avec le proxy local (live_tunnel.sh)
   Variables (wrangler.toml) :
     OLLAMA_ORIGIN   # URL du tunnel (front du proxy local), ex https://ollama-copilot.kev1ncockpit.com
     ALLOWED_ORIGINS # origines autorisees, separees par des virgules
   ========================================================================= */

const ALLOWED_ROUTES = new Set(['/api/tags', '/api/chat']);
const ALLOWED_MODELS = [/^qwen2\.5:(3b|7b|1\.5b|14b)/i, /^qwen2\.5/i]; // liste blanche
const MAX_BODY = 32 * 1024;         // 32 KB max par requete
const RATE_LIMIT = 40;              // requetes...
const RATE_WINDOW = 5 * 60;         // ...par IP sur 5 min

function allowedOrigin(origin, env) {
  const list = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return origin && list.includes(origin) ? origin : (list[0] || '');
}
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-onatera-live',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
// Comparaison a temps constant (evite un oracle de timing sur le jeton).
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { ...cors, 'content-type': 'application/json' } });
}
async function rateLimited(req, env) {
  // Limitation simple via l'API Cache (best-effort, sans dependance/KV).
  try {
    const ip = req.headers.get('cf-connecting-ip') || '0.0.0.0';
    const bucket = Math.floor(Date.now() / 1000 / RATE_WINDOW);
    const key = new Request('https://rl.local/' + bucket + '/' + ip);
    const cache = caches.default;
    let hit = await cache.match(key);
    let n = 0;
    if (hit) n = Number(await hit.text()) || 0;
    n += 1;
    await cache.put(key, new Response(String(n), { headers: { 'Cache-Control': 'max-age=' + RATE_WINDOW } }));
    return n > RATE_LIMIT;
  } catch (_) { return false; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const okOrigin = allowedOrigin(origin, env);
    const cors = corsHeaders(okOrigin);

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // 1. origine autorisee
    if (origin && !okOrigin) return json({ error: 'origine non autorisee' }, 403, cors);

    // 2. route autorisee
    if (!ALLOWED_ROUTES.has(url.pathname)) return json({ error: 'route non autorisee' }, 404, cors);

    // 3. jeton d'acces
    if (!env.DEMO_TOKEN || !safeEqual(req.headers.get('X-Onatera-Live'), env.DEMO_TOKEN))
      return json({ error: 'jeton invalide' }, 401, cors);

    // 4. limitation de debit
    if (await rateLimited(req, env)) return json({ error: 'trop de requetes, reessayez plus tard' }, 429, cors);

    if (!env.OLLAMA_ORIGIN) return json({ error: 'pont non configure' }, 503, cors);

    // --- /api/tags : simple relais GET ---
    if (url.pathname === '/api/tags' && req.method === 'GET') {
      const r = await forward(env, '/api/tags', { method: 'GET' });
      return relay(r, cors);
    }

    // --- /api/chat : POST, taille bornee + modele en liste blanche ---
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ error: 'requete trop volumineuse' }, 413, cors);
      let body; try { body = JSON.parse(raw); } catch (_) { return json({ error: 'JSON invalide' }, 400, cors); }
      const model = String(body.model || '');
      if (!ALLOWED_MODELS.some(re => re.test(model))) return json({ error: 'modele non autorise' }, 403, cors);
      const r = await forward(env, '/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
      });
      return relay(r, cors);
    }

    return json({ error: 'methode non autorisee' }, 405, cors);
  },
};

// Relaie vers Ollama via le tunnel, en presentant le secret d'origine.
function forward(env, path, init) {
  const target = env.OLLAMA_ORIGIN.replace(/\/+$/, '') + path;
  const headers = Object.assign({}, init.headers || {});
  if (env.ORIGIN_SECRET) headers['Authorization'] = 'Bearer ' + env.ORIGIN_SECRET;
  headers['Host'] = 'localhost:11434'; // Ollama refuse un Host non-local
  return fetch(target, { method: init.method, headers, body: init.body });
}
// Re-emet la reponse (y compris le streaming) avec les en-tetes CORS.
function relay(r, cors) {
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  h.delete('access-control-allow-origin');
  h.set('Access-Control-Allow-Origin', cors['Access-Control-Allow-Origin']);
  return new Response(r.body, { status: r.status, headers: h });
}
