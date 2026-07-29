// GET /api/ri — données "Service RI" (Pipedrive Projects), réparties par le champ "Relation Garage".
// Auth obligatoire. Cache privé. Démo si Projects/champ indisponible.
//
// Config (variables d'environnement, à renseigner une fois les champs créés côté Pipedrive) :
//   PIPEDRIVE_RI_FIELD        clé du champ personnalisé "Relation Garage" (sur le projet)
//   PIPEDRIVE_RI_DATE_BDC     clé du champ date tamponné "Date BDC à signer"
//   PIPEDRIVE_RI_DATE_ARELANCER  clé du champ date "Date A relancer"
//   PIPEDRIVE_RI_DATE_CTRL1   clé du champ date "Date Contrôle 1 terminé"
//   PIPEDRIVE_RI_DATE_PAIEMENT clé du champ date "Date Paiement total"

const { getConfig, pdGetAll, pdGet } = require('./_pipedrive');
const { isAuthed, authRequired } = require('./_auth');
const { buildRiDemo, RI_COLLABS } = require('./_ri');

function cf(e, key) {
  if (!key || !e) return undefined;
  if (e.custom_fields && e.custom_fields[key] !== undefined) return e.custom_fields[key];
  return e[key];
}
function idOf(v) { if (v == null) return null; return typeof v === 'object' ? (v.id != null ? v.id : v.value) : v; }

module.exports = async (req, res) => {
  const nowMs = Date.now();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!isAuthed(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 401;
    res.end(JSON.stringify({ error: true, auth: true, status: 401, message: 'Connexion requise.' }));
    return;
  }
  res.setHeader('Cache-Control', authRequired() ? 'private, max-age=300' : 's-maxage=300, stale-while-revalidate=86400');

  const cfg = getConfig();
  const riField = process.env.PIPEDRIVE_RI_FIELD || '';

  const sendDemo = (reason) => {
    const d = buildRiDemo(nowMs);
    res.statusCode = 200;
    res.end(JSON.stringify({ demo: true, reason, generatedAt: new Date(nowMs).toISOString(), ...d }));
  };

  // Sans token OU sans champ "Relation Garage" configuré -> démo (on ne peut pas répartir par RI).
  if (!cfg || !riField) return sendDemo(!cfg ? 'no_token' : 'no_ri_field');

  try {
    const dateFields = {
      bdc: process.env.PIPEDRIVE_RI_DATE_BDC || '',
      arelancer: process.env.PIPEDRIVE_RI_DATE_ARELANCER || '',
      ctrl1: process.env.PIPEDRIVE_RI_DATE_CTRL1 || '',
      paiement: process.env.PIPEDRIVE_RI_DATE_PAIEMENT || '',
    };
    const keys = [riField, dateFields.bdc, dateFields.arelancer, dateFields.ctrl1, dateFields.paiement].filter(Boolean);

    const [projectsRaw, phasesRaw, fieldDefs] = await Promise.all([
      pdGetAll('/projects'),
      pdGetAll('/projects/phases').catch(() => []),
      pdGet('/projectFields', {}, 'v1').then((r) => r.data || []).catch(() => []),
    ]);
    if (!Array.isArray(projectsRaw) || !projectsRaw.length) return sendDemo('no_projects');

    // Table de correspondance option_id -> libellé pour le champ "Relation Garage" (si champ à choix).
    const riDef = (fieldDefs || []).find((f) => f.key === riField);
    const optLabel = new Map();
    if (riDef && Array.isArray(riDef.options)) riDef.options.forEach((o) => optLabel.set(String(o.id), o.label));
    const riLabel = (v) => {
      if (v == null) return null;
      if (typeof v === 'object') v = v.id != null ? v.id : v.value;
      const byId = optLabel.get(String(v));
      return byId != null ? byId : String(v);
    };

    const projects = projectsRaw.map((p) => {
      const c = {};
      c.relation_garage = riLabel(cf(p, riField));
      if (dateFields.bdc) c.date_bdc = cf(p, dateFields.bdc) || null;
      if (dateFields.arelancer) c.date_arelancer = cf(p, dateFields.arelancer) || null;
      if (dateFields.ctrl1) c.date_ctrl1 = cf(p, dateFields.ctrl1) || null;
      if (dateFields.paiement) c.date_paiement = cf(p, dateFields.paiement) || null;
      return {
        id: p.id, title: p.title, deal_ids: p.deal_ids || [],
        status: p.status, phase_id: idOf(p.phase_id), board_id: idOf(p.board_id),
        start_date: p.start_date || null, end_date: p.end_date || null,
        update_time: p.update_time || p.updated || null,
        custom_fields: c,
      };
    });

    res.statusCode = 200;
    res.end(JSON.stringify({
      demo: false, generatedAt: new Date(nowMs).toISOString(),
      projects,
      phases: (phasesRaw || []).map((p) => ({ id: p.id, name: p.name })),
      boards: [], collaborators: RI_COLLABS,
      riField, dateFields,
    }));
  } catch (err) {
    sendDemo('error');
  }
};
