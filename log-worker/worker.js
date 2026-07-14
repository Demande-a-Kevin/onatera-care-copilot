// Onatera Copilot - Worker de journalisation (démo).
// - POST /log : ajoute une analyse (ticket + résultat) au journal.
// - GET /?token=... : page HTML d'historique (protégée par ADMIN_TOKEN).
// - GET /api?token=... : historique en JSON.
// - GET /flush?token=... : vide le journal.
// Isolé de toute prod ; supprimable après l'entretien (voir README).
//
// Sobriété KV : le journal tient dans UNE seule clé JSON ("logs").
//   -> consultation = 1 lecture KV (pas de "list", pas de N "get").
//   -> le token est vérifié AVANT tout accès KV (un scan sans token = 0 op).
// Aucune page ne s'auto-rafraîchit (évite toute boucle si un onglet reste ouvert).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const KEY = "logs";
const MAX = 300; // on ne garde que les 300 dernières analyses
const S = (v, n) => String(v == null ? "" : v).slice(0, n);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function readLogs(env) {
  const raw = await env.LOGS.get(KEY);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    // --- enregistrement (public, 1 lecture + 1 écriture) ---
    if (req.method === "POST" && url.pathname === "/log") {
      try {
        const b = await req.json();
        const arr = (v) => Array.isArray(v) ? v : [];
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
          sources: arr(b.sources).slice(0, 8).map((s) => ({ nom: S(s.nom, 120), url: S(s.url, 300), type: S(s.type, 20) })),
          actions: arr(b.actions).slice(0, 10).map((a) => ({ service: S(a.service, 60), action: S(a.action, 300), priorite: S(a.priorite, 20), delai: S(a.delai, 20) })),
          recos: arr(b.recos).slice(0, 6).map((r) => ({ nom: S(r.nom, 120), prix: S(r.prix, 20), vigilance: S(r.vigilance, 300) })),
          pays: (req.cf && req.cf.country) || "",
          ville: (req.cf && req.cf.city) || "",
        };
        const logs = await readLogs(env);
        logs.unshift(entry);
        if (logs.length > MAX) logs.length = MAX;
        await env.LOGS.put(KEY, JSON.stringify(logs));
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 400);
      }
    }

    // --- routes protégées : token vérifié AVANT tout accès KV ---
    const token = url.searchParams.get("token") || "";
    const authed = env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;

    if (url.pathname === "/flush") {
      if (!authed) return new Response("Acces refuse.", { status: 401 });
      await env.LOGS.put(KEY, "[]");
      return Response.redirect(url.origin + "/?token=" + encodeURIComponent(token), 302);
    }

    if (url.pathname === "/" || url.pathname === "/api") {
      if (!authed) return new Response("Acces refuse. Ouvrez cette URL avec ?token=VOTRE_TOKEN", { status: 401 });
      const entries = await readLogs(env); // 1 lecture KV
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
    const sources = Array.isArray(e.sources) ? e.sources : [];
    const actions = Array.isArray(e.actions) ? e.actions : [];
    const recos = Array.isArray(e.recos) ? e.recos : [];
    const srcHtml = sources.length ? `<div class="blk"><h4>Fiches utilisées</h4>${sources.map((s) =>
      s.url ? `<a class="chip" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.nom)} &#8599;</a>`
            : `<span class="chip">${esc(s.nom)}</span>`).join(" ")}</div>` : "";
    const recoHtml = recos.length ? `<div class="blk"><h4>Produits recommandés</h4>${recos.map((r) =>
      `<div class="reco"><b>${esc(r.nom)}</b>${r.prix ? ` <span class="prix">${esc(r.prix)}</span>` : ""}${r.vigilance ? `<div class="vig">&#9888;&#65039; ${esc(r.vigilance)}</div>` : ""}</div>`).join("")}</div>` : "";
    const actHtml = actions.length ? `<div class="blk"><h4>Actions internes</h4><ul>${actions.map((a) =>
      `<li><b>${esc(a.service)}</b> — ${esc(a.action)}${(a.priorite || a.delai) ? ` <i>(${esc(a.priorite)}${a.delai ? ", " + esc(a.delai) : ""})</i>` : ""}</li>`).join("")}</ul></div>` : "";
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
      ${srcHtml}${recoHtml}${actHtml}
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
  .note{font-size:12px;color:var(--muted);margin:0 0 12px}
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
  .blk{margin-top:12px}
  .chip{display:inline-block;font-size:12px;background:var(--green-soft);border:1px solid #cadfd0;color:var(--green-dark);border-radius:999px;padding:3px 9px;margin:0 5px 5px 0;text-decoration:none}
  .reco{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:6px;background:#fff;font-size:13px}
  .reco .prix{font-size:12px;font-weight:700;color:var(--green-dark);background:var(--green-soft);border:1px solid #cadfd0;border-radius:999px;padding:1px 8px}
  .reco .vig{margin-top:5px;font-size:12.5px;background:#fcf2da;border:1px solid #ecd9a6;color:var(--amber);border-radius:6px;padding:5px 8px}
  .blk ul{margin:6px 0 0;padding-left:18px;font-size:13px}
  .blk li{margin:3px 0}
</style></head><body>
<header>
  <div><h1>Historique des tests - Onatera Copilot</h1><div class="sub">Analyses effectuées via la démo en ligne</div></div>
  <span class="count">${entries.length} test${entries.length > 1 ? "s" : ""}</span>
  <button onclick="location.reload()">Rafraîchir</button>
  <button onclick="if(confirm('Vider tout l\\'historique des tests ?'))location.href='/flush?token=${esc(token)}'" style="background:#fbe9e7;color:#b5352b">Vider</button>
</header>
<main>
  <p class="note">Cette page ne se rafraîchit pas toute seule — cliquez sur « Rafraîchir » pour actualiser. (Évite toute consommation inutile si l'onglet reste ouvert.)</p>
  ${entries.length ? rows : '<div class="empty">Aucun test enregistré pour le moment.</div>'}
</main>
</body></html>`;
}
