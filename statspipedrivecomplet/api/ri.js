// GET /api/ri — données "Service RI" (Pipedrive Projects), réparties par le champ "Relation Garage".
// Auth obligatoire. Aucune automatisation requise : tout se calcule sur la phase (stage_id),
// le statut et la dernière mise à jour du projet.
//
// La clé du champ "Relation Garage" est prise dans PIPEDRIVE_RI_FIELD si défini, sinon la clé
// connue par défaut (ce compte), sinon auto-détectée par son nom dans les définitions de champs.
//
// Diagnostic : ouvrir /api/ri?debug=1 (connecté) pour voir les compteurs, phases, valeurs RI et erreurs.

const { getConfig, pdGetAll, pdGetAllV1, pdGetAllCursor, pdGet } = require('./_pipedrive');
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

  const [boardRes, fieldDefs, users] = await Promise.all([
    firstOk('boards', [
      { label: 'v1 /projects/boards', fn: () => pdGetAllV1('/projects/boards') },
      { label: 'v2 /projects/boards', fn: () => pdGetAll('/projects/boards') },
    ]),
    safe('projectFields', pdGetAll('/projectFields')),
    safe('users', pdGet('/users', {}, 'v1').then((r) => r.data || [])),
  ]);

  // ---- Projets : pagination par CURSEUR (l'endpoint ignore start/limit) ----
  // OPTIMISATION VITESSE : on NE récupère PAS les projets "completed" (le gros du volume, inutiles
  // aux bulles). On prend les OUVERTS (+ les ANNULÉS pour le taux). Si le filtre status est ignoré
  // par l'API, on détecte qu'on a déjà tout et on ne refait pas d'appel.
  let projectsRawSel = [], projUsed = null;
  try {
    const open = await pdGetAllCursor('/projects', 'v1', { status: 'open' });
    if (Array.isArray(open) && open.length) {
      const filterWorks = !open.some((p) => p.status && p.status !== 'open');
      if (filterWorks) {
        projectsRawSel = open; projUsed = 'v1 cursor status=open(+canceled)';
        try { const canc = await pdGetAllCursor('/projects', 'v1', { status: 'canceled' }); if (Array.isArray(canc)) projectsRawSel = projectsRawSel.concat(canc); }
        catch (e) { errs['projects:canceled'] = String((e && e.message) || e); }
      } else { projectsRawSel = open; projUsed = 'v1 cursor (status ignoré = tout)'; }
    }
  } catch (e) { errs['projects:open'] = String((e && e.message) || e); }
  if (!projectsRawSel.length) {
    for (const c of [
      { label: 'v1 cursor', fn: () => pdGetAllCursor('/projects', 'v1') },
      { label: 'v2 cursor', fn: () => pdGetAllCursor('/projects', 'v2') },
      { label: 'v1 start/limit', fn: () => pdGetAllV1('/projects') },
    ]) {
      try { const v = await c.fn(); if (Array.isArray(v) && v.length > projectsRawSel.length) { projectsRawSel = v; projUsed = c.label; } }
      catch (e) { errs['projects:' + c.label] = String((e && e.message) || e); }
    }
  }
  // Déduplication de sécurité par id.
  const seenIds = new Set();
  const projectsRaw = projectsRawSel.filter((p) => { const k = p && p.id; if (k == null) return true; if (seenIds.has(k)) return false; seenIds.add(k); return true; });
  const boards = boardRes.v || [];
  // Les phases se récupèrent PAR board (l'endpoint exige un board_id).
  let phasesRaw = [];
  for (const bd of boards) {
    try {
      const ph = await pdGetAllV1('/projects/phases', { board_id: bd.id });
      if (Array.isArray(ph)) phasesRaw = phasesRaw.concat(ph.map((x) => ({ id: x.id, name: x.name, board_id: bd.id, order_nr: x.order_nr })));
    } catch (e) { errs['phases:board:' + bd.id] = String((e && e.message) || e); }
  }
  const endpointsUsed = { projects: projUsed, boards: boardRes.used, boardsCount: boards.length };

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
    const ftok = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[\s\-']/)[0];
    const riToks = new Set(riMapped.map(ftok));
    const matched6 = RI_COLLABS.filter((c) => riToks.has(ftok(c)));
    const parseT = (s) => { if (!s) return null; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? null : d.getTime(); };
    const range = (arr) => { const a = arr.filter((v) => v != null); return a.length ? { min: new Date(Math.min(...a)).toISOString().slice(0, 10), max: new Date(Math.max(...a)).toISOString().slice(0, 10) } : null; };
    const dateRange = { add_time: range(raw.map((p) => parseT(p.add_time))), update_time: range(raw.map((p) => parseT(p.update_time))) };
    // Sonde NOTES : structure et rattachement (note -> projet ?) pour le "délai de réponse".
    let notesProbe = null;
    for (const attempt of [
      { label: 'v1 /notes', fn: () => pdGet('/notes', { limit: 15, sort: 'add_time DESC' }, 'v1') },
      { label: 'v2 /notes', fn: () => pdGet('/notes', { limit: 15 }, 'v2') },
    ]) {
      try {
        const nr = await attempt.fn();
        const notes = (nr && nr.data) || [];
        notesProbe = {
          used: attempt.label, count: notes.length,
          firstKeys: notes[0] ? Object.keys(notes[0]) : [],
          echantillon: notes.slice(0, 8).map((n) => ({ id: n.id, add_time: n.add_time, update_time: n.update_time, project_id: n.project_id, deal_id: n.deal_id, lead_id: n.lead_id, person_id: n.person_id, org_id: n.org_id, user_id: n.user_id })),
        };
        break;
      } catch (e) { errs['notes:' + attempt.label] = String((e && e.message) || e); }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(JSON.stringify({
      debug: true, riField,
      endpointsUsed,
      errors: errs,
      counts: { projects: raw.length, phases: (phasesRaw || []).length, projectFields: defs.length, users: (users || []).length },
      dateRange,
      phaseNames: (phasesRaw || []).map((p) => ({ id: p.id, name: p.name, order_nr: p.order_nr })),
      sampleProjectKeys: Object.keys(sample),
      sampleProject: { status: sample.status, stage_id: sample.stage_id, phase_id: sample.phase_id, update_time: sample.update_time, ri_raw: cf(sample, riField), ri_mapped: riLabel(cf(sample, riField)) },
      distinctStageIds: [...new Set(raw.map((p) => idOf(p.stage_id != null ? p.stage_id : p.phase_id)))].slice(0, 30),
      distinctRiValues: [...new Set(riMapped)].slice(0, 60),
      collaborators: RI_COLLABS,
      matched6_dansLesDonnees: matched6,
      notesProbe,
    }, null, 2));
    return;
  }

  res.setHeader('Cache-Control', authRequired() ? 'private, max-age=300' : 's-maxage=300, stale-while-revalidate=86400');

  if (!Array.isArray(projectsRaw) || !projectsRaw.length) {
    return sendEmpty('no_projects', { errors: errs, endpointsUsed });
  }

  // ---- "Délai de réponse" : dernière note du RI sur le projet ----
  // Signaux = champ modifié (update_time) OU avancement de phase (status_change_time) OU note du RI.
  const srvT = (s) => { if (!s) return 0; let x = String(s).trim().replace(' ', 'T'); if (!/[zZ]|[+\-]\d\d:?\d\d$/.test(x)) x += 'Z'; const d = new Date(x); return isNaN(d) ? 0 : d.getTime(); };
  const riUserId = (v) => { if (v == null) return null; if (typeof v === 'object') v = (v.id != null ? v.id : v.value); const n = Number(v); return Number.isFinite(n) ? n : null; };
  const projRiUser = new Map(projectsRaw.map((p) => [Number(p.id), riUserId(cf(p, riField))]));

  // Récupère les notes récentes (triées par date décroissante), plafonné pour la performance.
  const NOTE_MAX_PAGES = 10;
  const fetchRecentNotes = async () => {
    let out = [], start = 0, cursor = null, useCursor = false;
    for (let i = 0; i < NOTE_MAX_PAGES; i++) {
      const params = useCursor ? { limit: 500, cursor } : { limit: 500, start, sort: 'add_time DESC' };
      let page;
      try { page = await pdGet('/notes', params, 'v1'); } catch (e) { errs['notes:fetch'] = String((e && e.message) || e); break; }
      if (Array.isArray(page.data)) out = out.concat(page.data);
      const ad = page.additional_data || {};
      if (ad.next_cursor) { useCursor = true; cursor = ad.next_cursor; }
      else if (ad.pagination && ad.pagination.more_items_in_collection) { start = ad.pagination.next_start; }
      else break;
    }
    return out;
  };
  const notes = await fetchRecentNotes();
  // Par projet : date de la note la plus récente postée PAR LE RI assigné au projet.
  const projNoteTs = new Map();
  for (const n of notes) {
    const pj = n.project_id != null ? Number(n.project_id) : null;
    if (pj == null) continue;
    const ri = projRiUser.get(pj);
    if (ri != null && Number(n.user_id) !== ri) continue; // uniquement les notes du RI du projet
    const t = srvT(n.add_time);
    if (t && (!projNoteTs.has(pj) || t > projNoteTs.get(pj))) projNoteTs.set(pj, t);
  }
  const notesCovered = projNoteTs.size;

  const projects = projectsRaw.map((p) => {
    const respMs = Math.max(srvT(p.update_time), srvT(p.status_change_time), projNoteTs.get(Number(p.id)) || 0);
    return {
      id: p.id, title: p.title, deal_ids: p.deal_ids || [],
      status: p.status,
      phase_id: idOf(p.phase_id != null ? p.phase_id : p.stage_id), // la donnée projet expose "phase_id"
      board_id: idOf(p.board_id != null ? p.board_id : p.pipeline_id),
      add_time: p.add_time || null, // date de création (cohorte du taux de transformation)
      start_date: p.start_date || null, end_date: p.end_date || null,
      update_time: p.update_time || p.status_change_time || p.updated || null,
      status_change_time: p.status_change_time || null, // date du dernier changement de statut (annulation)
      // Date de dernière "réponse" (max des 3 signaux) — utilisée pour le délai de réponse.
      resp_time: respMs ? new Date(respMs).toISOString() : (p.update_time || null),
      custom_fields: { relation_garage: riLabel(cf(p, riField)) },
    };
  });

  // Liste des RI présents dans les données (dynamique) : whoever a un projet avec "Relation Garage".
  const foundRIs = [...new Set(projects.map((p) => p.custom_fields.relation_garage).filter((v) => v != null && String(v).trim() !== ''))]
    .sort((a, b) => String(a).localeCompare(String(b), 'fr'));

  res.statusCode = 200;
  res.end(JSON.stringify({
    demo: false, generatedAt: new Date(nowMs).toISOString(),
    projects,
    phases: (phasesRaw || []).map((p) => ({ id: p.id, name: p.name, order_nr: p.order_nr })),
    boards: (boards || []).map((b) => ({ id: b.id, name: b.name })),
    collaborators: RI_COLLABS,        // on garde uniquement les 6 RI
    foundRIs,                         // tous les RI présents (info)
    riField: 'relation_garage',       // clé sous laquelle la valeur est exposée à la page
    riSource: riField,                // clé Pipedrive réelle (info)
    notesCovered,                     // nb de projets ayant une note récente du RI (info)
  }));
};
