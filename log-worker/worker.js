// Onatera Copilot - Worker de journalisation (démo).
// - POST /log : enregistre une analyse (ticket + résultat) dans KV (TTL 30 j).
// - GET /?token=... : page HTML d'historique (protégée par ADMIN_TOKEN).
// - GET /api?token=... : historique en JSON.
// Isolé de toute prod ; supprimable après l'entretien (voir README).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const S = (v, n) => String(v == null ? "" : v).slice(0, n);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    // --- enregistrement d'une analyse ---
    if (req.method === "POST" && url.pathname === "/log") {
      try {
        const b = await req.json();
        const entry = {
          ts: new Date().toISOString(),
          mode: S(b.mode, 10),
          model: S(b.model, 40),
          ticket: S(b.ticket, 2000),
          categorie: S(b.categorie, 40),
          gravite: S(b.gravite, 20),
          niveau_risque: S(b.niveau_risque, 20),
          reco: Number(b.reco || 0),
          reponse: S(b.reponse, 3000),
          pays: (req.cf && req.cf.country) || "",
          ville: (req.cf && req.cf.city) || "",
          ua: S(req.headers.get("user-agent"), 140),
        };
        const key = "log:" + entry.ts + ":" + Math.random().toString(36).slice(2, 7);
        await env.LOGS.put(key, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 * 30 });
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 400);
      }
    }

    // --- lecture (protégée) ---
    if (url.pathname === "/" || url.pathname === "/api") {
      const token = url.searchParams.get("token") || "";
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN)
        return new Response("Acces refuse. Ouvrez cette URL avec ?token=VOTRE_TOKEN", { status: 401 });
      const list = await env.LOGS.list({ prefix: "log:", limit: 1000 });
      const entries = [];
      for (const k of list.keys) {
        const v = await env.LOGS.get(k.name);
        if (v) { try { entries.push(JSON.parse(v)); } catch (_) {} }
      }
      entries.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
      if (url.pathname === "/api")
        return new Response(JSON.stringify(entries, null, 2), { headers: { ...CORS, "content-type": "application/json" } });
      return new Response(renderHTML(entries, token), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("Onatera Copilot - log worker", { headers: CORS });
  },
};

function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { ...CORS, "content-type": "application/json" } });
}

function renderHTML(entries, token) {
  const rows = entries.map((e) => {
    const d = new Date(e.ts);
    const when = isNaN(d) ? esc(e.ts) : d.toLocaleString("fr-FR");
    const loc = [e.ville, e.pays].filter(Boolean).join(", ");
    const risk = (e.niveau_risque || "").toLowerCase();
    return `<article class="card">
      <div class="meta">
        <span class="when">${when}</span>
        <span class="pill ${e.mode === "live" ? "live" : "demo"}">${esc(e.mode || "?")}</span>
        ${e.model ? `<span class="pill model">${esc(e.model)}</span>` : ""}
        ${e.categorie ? `<span class="pill">${esc(e.categorie)}</span>` : ""}
        ${e.niveau_risque ? `<span class="pill risk-${esc(risk)}">risque ${esc(e.niveau_risque)}</span>` : ""}
        ${e.reco ? `<span class="pill">${e.reco} reco</span>` : ""}
        ${loc ? `<span class="loc">${esc(loc)}</span>` : ""}
      </div>
      <div class="cols">
        <div><h4>Ticket testé</h4><pre>${esc(e.ticket) || "<i>(vide)</i>"}</pre></div>
        <div><h4>Réponse proposée</h4><pre>${esc(e.reponse) || "<i>(vide)</i>"}</pre></div>
      </div>
    </article>`;
  }).join("");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Historique des tests - Onatera Copilot</title>
<style>
  :root{--green:#2f6b4f;--green-dark:#1e4d38;--green-soft:#e5efe8;--cream:#f7f3ea;--ink:#20261f;--muted:#6b7469;--line:#dfe4d8;--red:#b5352b;--amber:#8a5a00}
  *{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--cream);color:var(--ink)}
  header{background:var(--green-dark);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  header h1{font-size:16px;margin:0}header .sub{font-size:12px;color:#cfe0d6}
  header .count{margin-left:auto;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:4px 12px;font-size:13px}
  header button{background:#fff;color:var(--green-dark);border:0;border-radius:8px;padding:7px 12px;font-weight:600;cursor:pointer}
  main{max-width:1080px;margin:0 auto;padding:18px}
  .empty{color:var(--muted);text-align:center;padding:60px 10px}
  .card{background:#fffdf8;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .meta{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-bottom:10px}
  .when{font-weight:700;font-size:13px}
  .pill{font-size:12px;background:var(--green-soft);border:1px solid #cadfd0;color:var(--green-dark);border-radius:999px;padding:2px 9px}
  .pill.live{background:#dff0e6;color:var(--green-dark);font-weight:700}
  .pill.demo{background:#fcf2da;border-color:#ecd9a6;color:var(--amber)}
  .pill.model{background:#eef2f6;border-color:#d6e0ea;color:#2a5b7a}
  .pill.risk-critique,.pill.risk-eleve{background:#fbe9e7;border-color:#eec3bd;color:var(--red)}
  .loc{margin-left:auto;font-size:12px;color:var(--muted)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:720px){.cols{grid-template-columns:1fr}}
  h4{margin:0 0 5px;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
  pre{white-space:pre-wrap;font-family:inherit;font-size:13px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px;margin:0;max-height:260px;overflow:auto}
</style></head><body>
<header>
  <div><h1>Historique des tests - Onatera Copilot</h1><div class="sub">Analyses effectuées via la démo en ligne</div></div>
  <span class="count">${entries.length} test${entries.length > 1 ? "s" : ""}</span>
  <button onclick="location.reload()">Rafraîchir</button>
</header>
<main>${entries.length ? rows : '<div class="empty">Aucun test enregistré pour le moment.</div>'}</main>
<script>setTimeout(()=>location.reload(),60000);</script>
</body></html>`;
}
