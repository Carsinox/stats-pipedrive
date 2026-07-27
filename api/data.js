// Endpoint serverless : GET /api/data
// Charge les données brutes Pipedrive UNE SEULE FOIS (allégées), fortement mises en cache.
// Le navigateur fait ensuite tous les filtres (commercial / pipeline / période) instantanément.

const { getConfig, pdGet, pdGetAll, pdGetAllV1 } = require('./_pipedrive');
const { getMapping, isMapped } = require('./_config');
const { buildDemo } = require('./_demo');

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

module.exports = async (req, res) => {
  const nowMs = Date.now();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Sert une version fraîche 5 min, puis sert instantanément la version en cache
  // tout en la rafraîchissant en tâche de fond (l'utilisateur n'attend plus).
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');

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

  // ---- Mode réel ----
  try {
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

    res.statusCode = 200;
    res.end(JSON.stringify({
      demo: false, generatedAt: new Date(nowMs).toISOString(),
      mapping: publicMapping(mapping),
      pipelines: pipeList, users,
      deals: deals.map((d) => slimDeal(d, mapping.mandatDateField, mapping.ceField, mapping.ceDateField)),
      leads: leads.map((l) => slimLead(l, mapping.ceField, mapping.ceDateField)),
    }));
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
