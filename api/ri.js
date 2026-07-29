// GET /api/ri — données "Service RI" (Pipedrive Projects), réparties par le champ "Relation Garage".
// Auth obligatoire. Aucune automatisation requise : tout se calcule sur la phase (stage_id),
// le statut et la dernière mise à jour du projet.
//
// La clé du champ "Relation Garage" est prise dans PIPEDRIVE_RI_FIELD si défini, sinon la clé
// connue par défaut (ce compte), sinon auto-détectée par son nom dans les définitions de champs.
//
// Diagnostic : ouvrir /api/ri?debug=1 (connecté) pour voir les compteurs, phases, valeurs RI et erreurs.

const { getConfig, pdGetAll, pdGetAllV1, pdGet } = require('./_pipedrive');
const { isAuthed, authRequired } = require('./_auth');
const { RI_COLLABS } = require('./_ri');

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

  // Plus de démo : on renvoie un état vide honnête (la page affiche un message clair).
  const sendEmpty = (reason, extra) => {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(JSON.stringify({ demo: false, empty: true, reason, ...(extra || {}), generatedAt: new Date(nowMs).toISOString(), projects: [], phases: [], boards: [], collaborators: RI_COLLABS, riField }));
  };

  if (!cfg) return sendEmpty('no_token');

  // Récupération avec capture d'erreur par appel (pour le diagnostic).
  const errs = {};
  const safe = (label, promise) => promise.then((v) => v).catch((e) => { errs[label] = String((e && e.message) || e); return null; });
  // Essaie plusieurs chemins et garde le premier qui renvoie un tableau (les projets/phases
  // ne sont pas au même endroit selon les comptes : liste en v1, détail en v2).
  const firstOk = async (label, candidates) => {
    for (const c of candidates) {
      try { const v = await c.fn(); if (Array.isArray(v)) return { v, used: c.label }; }
      catch (e) { errs[label + ':' + c.label] = String((e && e.message) || e); }
    }
    return { v: [], used: null };
  };

  const [projRes, boardRes, fieldDefs, users] = await Promise.all([
    firstOk('projects', [
      { label: 'v1 /projects', fn: () => pdGetAllV1('/projects') },
      { label: 'v2 /projects', fn: () => pdGetAll('/projects') },
    ]),
    firstOk('boards', [
      { label: 'v1 /projects/boards', fn: () => pdGetAllV1('/projects/boards') },
      { label: 'v2 /projects/boards', fn: () => pdGetAll('/projects/boards') },
    ]),
    safe('projectFields', pdGetAll('/projectFields')),
    safe('users', pdGet('/users', {}, 'v1').then((r) => r.data || [])),
  ]);
  const projectsRaw = projRes.v;
  const boards = boardRes.v || [];
  // Les phases se récupèrent PAR board (l'endpoint exige un board_id).
  let phasesRaw = [];
  for (const bd of boards) {
    try {
      const ph = await pdGetAllV1('/projects/phases', { board_id: bd.id });
      if (Array.isArray(ph)) phasesRaw = phasesRaw.concat(ph.map((x) => ({ id: x.id, name: x.name, board_id: bd.id })));
    } catch (e) { errs['phases:board:' + bd.id] = String((e && e.message) || e); }
  }
  const endpointsUsed = { projects: projRes.used, boards: boardRes.used, boardsCount: boards.length };

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
      endpointsUsed,
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
    return sendEmpty('no_projects', { errors: errs, endpointsUsed });
  }

  const projects = projectsRaw.map((p) => ({
    id: p.id, title: p.title, deal_ids: p.deal_ids || [],
    status: p.status,
    phase_id: idOf(p.phase_id != null ? p.phase_id : p.stage_id), // la donnée projet expose "phase_id"
    board_id: idOf(p.board_id != null ? p.board_id : p.pipeline_id),
    start_date: p.start_date || null, end_date: p.end_date || null,
    update_time: p.update_time || p.status_change_time || p.updated || null,
    custom_fields: { relation_garage: riLabel(cf(p, riField)) },
  }));

  // Liste des RI présents dans les données (dynamique) : whoever a un projet avec "Relation Garage".
  const foundRIs = [...new Set(projects.map((p) => p.custom_fields.relation_garage).filter((v) => v != null && String(v).trim() !== ''))]
    .sort((a, b) => String(a).localeCompare(String(b), 'fr'));

  res.statusCode = 200;
  res.end(JSON.stringify({
    demo: false, generatedAt: new Date(nowMs).toISOString(),
    projects,
    phases: (phasesRaw || []).map((p) => ({ id: p.id, name: p.name })),
    boards: (boards || []).map((b) => ({ id: b.id, name: b.name })),
    collaborators: foundRIs,          // RI réellement présents
    knownCollabs: RI_COLLABS,         // les 6 souhaités (info)
    riField: 'relation_garage',       // clé sous laquelle la valeur est exposée à la page
    riSource: riField,                // clé Pipedrive réelle (info)
  }));
};
