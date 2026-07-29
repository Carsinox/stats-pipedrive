// GET /api/ri — données "Service RI" (Pipedrive Projects), réparties par le champ "Relation Garage".
// Auth obligatoire. Aucune automatisation requise : tout se calcule sur la phase (stage_id),
// le statut et la dernière mise à jour du projet.
//
// La clé du champ "Relation Garage" est prise dans PIPEDRIVE_RI_FIELD si défini, sinon la clé
// connue par défaut (ce compte), sinon auto-détectée par son nom dans les définitions de champs.
//
// Diagnostic : ouvrir /api/ri?debug=1 (connecté) pour voir les compteurs, phases, valeurs RI et erreurs.

const { getConfig, pdGetAll, pdGet } = require('./_pipedrive');
const { isAuthed, authRequired } = require('./_auth');
const { buildRiDemo, RI_COLLABS } = require('./_ri');

const RI_DEFAULT_FIELD = '92d31d377c1db9853b11373dcc6186b01da2da32'; // "Relation Garage" (champ user)

function cf(e, key) {
  if (!key || !e) return undefined;
  if (e.custom_fields && e.custom_fields[key] !== undefined) return e.custom_fields[key];
  return e[key];
}
function idOf(v) { if (v == null) return null; return typeof v === 'object' ? (v.id != null ? v.id : v.value) : v; }

module.exports = async (req, res) => {
  const nowMs = Date.now();
  const debug = /[?&]debug=1/.test(req.url || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!isAuthed(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 401;
    res.end(JSON.stringify({ error: true, auth: true, status: 401, message: 'Connexion requise.' }));
    return;
  }

  const cfg = getConfig();
  let riField = process.env.PIPEDRIVE_RI_FIELD || RI_DEFAULT_FIELD;

  const sendDemo = (reason, extra) => {
    const d = buildRiDemo(nowMs);
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(JSON.stringify({ demo: true, reason, ...(extra || {}), generatedAt: new Date(nowMs).toISOString(), ...d }));
  };

  if (!cfg) return sendDemo('no_token');

  // Récupération avec capture d'erreur par appel (pour le diagnostic).
  const errs = {};
  const safe = (label, promise) => promise.then((v) => v).catch((e) => { errs[label] = String((e && e.message) || e); return null; });

  const [projectsRaw, phasesRaw, fieldDefs, users] = await Promise.all([
    safe('projects', pdGetAll('/projects')),
    safe('phases', pdGetAll('/projects/phases')),
    safe('projectFields', pdGetAll('/projectFields')),
    safe('users', pdGet('/users', {}, 'v1').then((r) => r.data || [])),
  ]);

  // Auto-détection du champ RI si la clé n'est pas dans les définitions récupérées.
  const defs = fieldDefs || [];
  if (defs.length && !defs.find((f) => (f.field_code || f.key) === riField)) {
    const guess = defs.find((f) => /relation\s*garage|garage/i.test(f.field_name || f.name || ''));
    if (guess) riField = guess.field_code || guess.key;
  }

  const riDef = defs.find((f) => (f.field_code || f.key) === riField);
  const optLabel = new Map();
  if (riDef && Array.isArray(riDef.options)) riDef.options.forEach((o) => optLabel.set(String(o.id), o.label != null ? o.label : o.name));
  const userName = new Map((users || []).map((u) => [String(u.id), u.name]));
  const riLabel = (v) => {
    if (v == null) return null;
    if (Array.isArray(v)) v = v[0];
    if (v != null && typeof v === 'object') v = v.label != null ? v.label : (v.name != null ? v.name : (v.id != null ? v.id : v.value));
    const s = String(v);
    if (optLabel.has(s)) return optLabel.get(s);
    if (userName.has(s)) return userName.get(s);
    return s;
  };

  // ---- Mode diagnostic ----
  if (debug) {
    const raw = Array.isArray(projectsRaw) ? projectsRaw : [];
    const sample = raw[0] || {};
    const riMapped = raw.map((p) => riLabel(cf(p, riField)));
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(JSON.stringify({
      debug: true, riField,
      errors: errs,
      counts: { projects: raw.length, phases: (phasesRaw || []).length, projectFields: defs.length, users: (users || []).length },
      phaseNames: (phasesRaw || []).map((p) => ({ id: p.id, name: p.name })),
      sampleProjectKeys: Object.keys(sample),
      sampleProject: { status: sample.status, stage_id: sample.stage_id, phase_id: sample.phase_id, update_time: sample.update_time, ri_raw: cf(sample, riField), ri_mapped: riLabel(cf(sample, riField)) },
      distinctStageIds: [...new Set(raw.map((p) => idOf(p.stage_id != null ? p.stage_id : p.phase_id)))].slice(0, 30),
      distinctRiValues: [...new Set(riMapped)].slice(0, 40),
      collaborators: RI_COLLABS,
    }, null, 2));
    return;
  }

  res.setHeader('Cache-Control', authRequired() ? 'private, max-age=120' : 's-maxage=120, stale-while-revalidate=86400');

  if (!Array.isArray(projectsRaw) || !projectsRaw.length) {
    return sendDemo('no_projects', errs.projects ? { errorMessage: errs.projects } : undefined);
  }

  const projects = projectsRaw.map((p) => ({
    id: p.id, title: p.title, deal_ids: p.deal_ids || [],
    status: p.status,
    phase_id: idOf(p.stage_id != null ? p.stage_id : p.phase_id), // phase = stage_id (projects_phase)
    board_id: idOf(p.pipeline_id != null ? p.pipeline_id : p.board_id),
    start_date: p.start_date || null, end_date: p.end_date || null,
    update_time: p.update_time || p.status_change_time || p.updated || null,
    custom_fields: { relation_garage: riLabel(cf(p, riField)) },
  }));

  res.statusCode = 200;
  res.end(JSON.stringify({
    demo: false, generatedAt: new Date(nowMs).toISOString(),
    projects,
    phases: (phasesRaw || []).map((p) => ({ id: p.id, name: p.name })),
    boards: [], collaborators: RI_COLLABS, riField,
  }));
};
