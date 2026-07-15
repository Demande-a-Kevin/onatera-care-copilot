/* =========================================================================
   Proxy d'origine local (zero dependance, node:http).

   Le tunnel Cloudflare pointe sur CE proxy (pas sur Ollama directement). Il
   n'accepte que les requetes portant "Authorization: Bearer <ORIGIN_SECRET>"
   (le Worker pont l'ajoute), puis les relaie a Ollama sur 127.0.0.1:11434.
   Ainsi, meme si l'URL du tunnel fuite, ce n'est jamais un Ollama ouvert.

   Usage : ORIGIN_SECRET=xxxx node live-bridge/origin-proxy.mjs [port]
   Defaut : port 11435 -> 127.0.0.1:11434
   ========================================================================= */
import http from 'node:http';

const PORT = Number(process.argv[2] || process.env.PROXY_PORT || 11435);
const OLLAMA = { host: '127.0.0.1', port: 11434 };
const SECRET = process.env.ORIGIN_SECRET || '';
if (!SECRET) { console.error('ORIGIN_SECRET manquant. Refus de demarrer un proxy sans secret.'); process.exit(1); }

// Routes autorisees (defense en profondeur, en plus du Worker).
const ALLOWED = new Set(['/api/tags', '/api/chat']);

function timingSafe(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0];
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!timingSafe(token, SECRET)) { res.writeHead(401).end('unauthorized'); req.resume(); return; }
  if (!ALLOWED.has(path)) { res.writeHead(404).end('not found'); req.resume(); return; }

  const headers = { ...req.headers, host: 'localhost:11434' };
  delete headers['authorization']; // ne pas transmettre le secret d'origine a Ollama
  const opts = { host: OLLAMA.host, port: OLLAMA.port, method: req.method, path, headers };
  const up = http.request(opts, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('bad gateway'); });
  req.pipe(up);
});
server.listen(PORT, '127.0.0.1', () => console.log(`Proxy d'origine sur http://127.0.0.1:${PORT} -> Ollama:11434 (auth requise)`));
