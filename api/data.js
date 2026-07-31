// Endpoint serverless : GET /api/data
// Charge les données brutes Pipedrive UNE SEULE FOIS (allégées), fortement mises en cache.
// Le navigateur fait ensuite tous les filtres (commercial / pipeline / période) instantanément.
//
// Performance : la réponse est IDENTIQUE pour tous les utilisateurs connectés (le filtrage se
// fait côté navigateur). On garde donc le dernier instantané en mémoire de la fonction pendant
// un court instant (TTL) et on regroupe les requêtes simultanées (single-flight) : tant que
// l'instance serverless reste « chaude », les ouvertures suivantes répondent instantanément
// au lieu de re-paginer des milliers d'affaires depuis Pipedrive à chaque fois.

const { getConfig, pdGet, pdGetAll, pdGetAllV1 } = require('./_pipedrive');
const { getMapping, isMapped } = require('./_config');
const { buildDemo } = require('./_demo');
const { isAuthed, authRequired } = require('./_auth');

// --- Cache mémoire (survit aux invocations « chaudes » d'une même instance) + single-flight ---
const CACHE = { ts: 0, body: null };   // body = chaîne JSON déjà sérialisée
let INFLIGHT = null;                    // Promise en cours (déduplique les requêtes simultanées)
const TTL_MS = Number(process.env.DATA_CACHE_TTL_MS || 120000); // 2 min par défaut

function ownerId(e) {
  const o = e && (e.owner_id !== undefined ? e.owner_id : e.user_id);
  if (o == null) return null;
  return typeof o === 'object' ? (o.id != null ? o.id : o.value) : o;
}
function personId(e) {
  const p = e && e.person_id;
  if (p == null) return null;
  return typeof p === 'object' ? (p.value != null ? p.value : p.id) : p;
}
function cf(e, key) {
  if (!key) return undefined;
  if (e.custom_fields && e.custom_fields[key] !== undefined) return e.custom_fields[key];
  return e[key];
}
function customFields(e, keys) {
  const out = {};
  for (const k of keys) if (k) out[k] = cf(e, k);
  return out;
}
// Affaire allégée (inclut mandat, résultat d'appel, et date CE si présents).
function slimDeal(d, mandatKey, ceKey, ceDateKey) {
  return {
    pipeline_id: Number(d.pipeline_id) || null, status: d.status,
    owner_id: ownerId(d), person_id: personId(d), title: d.title,
    add_time: d.add_time, update_time: d.update_time, won_time: d.won_time, lost_time: d.lost_time,
    custom_fields: customFields(d, [mandatKey, ceKey, ceDateKey]),
  };
}
// Lead (prospect) allégé.
function slimLead(l, ceKey, ceDateKey) {
  return {
    owner_id: ownerId(l), person_id: personId(l), title: l.title,
    add_time: l.add_time, update_time: l.update_time,
    custom_fields: customFields(l, [ceKey, ceDateKey]),
  };
}
function publicMapping(m) {
  return {
    mandatValue: m.mandatValue, pipelines: m.pipelines, mandatDateField: m.mandatDateField,
    ceField: m.ceField, ceValues: m.ceValues, ceDateField: m.ceDateField,
  };
}

// Construit la charge utile RÉELLE et renvoie la chaîne JSON (contrat inchangé).
async function buildRealBody(nowMs, mapping) {
  const hasCE = !!mapping.ceField && mapping.ceValues.length;
  // Affaires : filtrées aux pipelines configurés côté serveur (moins de données à charger).
  const pipes = (mapping.pipelines && mapping.pipelines.length) ? mapping.pipelines : [null];
  const dealFetch = Promise.all(pipes.map((pid) => (pid ? pdGetAll('/deals', { pipeline_id: pid }) : pdGetAll('/deals'))))
    .then((arrs) => arrs.flat());

  const [pipelines, usersRaw, deals, leads] = await Promise.all([
    pdGetAll('/pipelines'),
    pdGet('/users', {}, 'v1').then((r) => r.data || []).catch(() => []),
    dealFetch,
    hasCE ? pdGetAllV1('/leads') : Promise.resolve([]),
  ]);

  const users = (usersRaw || [])
    .filter((u) => u.active_flag !== false)
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));

  const pipeFilter = (mapping.pipelines && mapping.pipelines.length) ? new Set(mapping.pipelines.map(Number)) : null;
  const pipeList = (pipelines || [])
    .filter((p) => !pipeFilter || pipeFilter.has(Number(p.id)))
    .map((p) => ({ id: p.id, name: p.name }));

  return JSON.stringify({
    demo: false, generatedAt: new Date(nowMs).toISOString(),
    mapping: publicMapping(mapping),
    pipelines: pipeList, users,
    deals: deals.map((d) => slimDeal(d, mapping.mandatDateField, mapping.ceField, mapping.ceDateField)),
    leads: leads.map((l) => slimLead(l, mapping.ceField, mapping.ceDateField)),
  });
}

module.exports = async (req, res) => {
  const t0 = process.hrtime.bigint();
  const nowMs = Date.now();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Verrou : sans session valide (quand un mot de passe est configuré), on refuse l'accès aux données.
  if (!isAuthed(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 401;
    res.end(JSON.stringify({ error: true, auth: true, status: 401, message: 'Connexion requise.' }));
    return;
  }

  // Cache HTTP :
  //  - Site protégé par mot de passe -> cache PRIVÉ (navigateur uniquement). Le CDN partagé
  //    ne doit jamais stocker ces données, sinon elles pourraient être servies à un visiteur
  //    non connecté. Le navigateur peut les garder 5 min pour ses propres requêtes.
  //  - Site ouvert (pas de mot de passe) -> cache CDN partagé + rafraîchissement en tâche de fond.
  if (authRequired()) {
    res.setHeader('Cache-Control', 'private, max-age=300');
  } else {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
  }

  const cfg = getConfig();
  const mapping = getMapping();

  // ---- Mode démo ----
  if (!cfg || !isMapped(mapping)) {
    const demo = buildDemo(nowMs);
    const m = demo.mapping;
    res.statusCode = 200;
    res.end(JSON.stringify({
      demo: true, reason: !cfg ? 'no_token' : 'no_mapping', generatedAt: new Date(nowMs).toISOString(),
      mapping: publicMapping(m),
      pipelines: demo.pipelines.map((p) => ({ id: p.id, name: p.name })),
      users: demo.users || [],
      deals: demo.deals.map((d) => slimDeal(d, m.mandatDateField, m.ceField, m.ceDateField)),
      leads: (demo.leads || []).map((l) => slimLead(l, m.ceField, m.ceDateField)),
    }));
    return;
  }

  // ---- Mode réel (avec cache mémoire + single-flight) ----
  // Le navigateur peut forcer un rafraîchissement complet avec ?fresh=... (bouton actualiser) :
  // dans ce cas on contourne le cache serveur.
  let bypass = false;
  try { bypass = new URL(req.url, 'http://x').searchParams.has('fresh'); } catch (_) {}

  try {
    let cacheState = 'MISS';
    let body;

    if (!bypass && CACHE.body && (nowMs - CACHE.ts) < TTL_MS) {
      body = CACHE.body;
      cacheState = 'HIT';
    } else if (!bypass && INFLIGHT) {
      // Une autre requête est déjà en train de recharger : on attend le même résultat.
      body = await INFLIGHT;
      cacheState = 'COALESCED';
    } else {
      const p = buildRealBody(nowMs, mapping).then((b) => {
        CACHE.body = b; CACHE.ts = Date.now();
        return b;
      }).finally(() => { INFLIGHT = null; });
      if (!bypass) INFLIGHT = p;
      body = await p;
    }

    const durMs = Number(process.hrtime.bigint() - t0) / 1e6;
    // Server-Timing : visible dans l'onglet Réseau des DevTools, ne change pas le corps de la réponse.
    res.setHeader('Server-Timing', `total;dur=${durMs.toFixed(0)}, cache;desc=${cacheState}`);
    res.statusCode = 200;
    res.end(body);
  } catch (err) {
    const status = err.status || 500;
    res.statusCode = status;
    res.end(JSON.stringify({
      error: true, status,
      message:
        status === 401 ? "Token Pipedrive invalide ou expiré (PIPEDRIVE_API_TOKEN)."
        : status === 404 ? "Domaine Pipedrive introuvable (PIPEDRIVE_DOMAIN)."
        : `Erreur Pipedrive : ${err.message}`,
    }));
  }
};
