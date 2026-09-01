// GET /api/projects — données du module Pipedrive Projects (allégées), pour la page /projets.
// Auth obligatoire. Cache privé (navigateur). Bascule en démo si Projects indisponible.

const { getConfig, pdGetAll, pdGet } = require('./_pipedrive');
const { isAuthed, authRequired } = require('./_auth');
const { buildProjectsDemo, slimProject, slimTask } = require('./_projects');

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

  const sendDemo = (reason) => {
    const d = buildProjectsDemo(nowMs);
    res.statusCode = 200;
    res.end(JSON.stringify({ demo: true, reason, generatedAt: new Date(nowMs).toISOString(), ...d }));
  };

  if (!cfg) return sendDemo('no_token');

  try {
    // API v2 (pagination par curseur, comme /deals). Tâches best-effort.
    const [projectsRaw, boardsRaw, phasesRaw, usersRaw, tasksRaw] = await Promise.all([
      pdGetAll('/projects'),
      pdGetAll('/projects/boards').catch(() => []),
      pdGetAll('/projects/phases').catch(() => []),
      pdGet('/users', {}, 'v1').then((r) => r.data || []).catch(() => []),
      pdGetAll('/tasks').catch(() => []),
    ]);

    if (!Array.isArray(projectsRaw) || !projectsRaw.length) return sendDemo('no_projects');

    const users = (usersRaw || [])
      .filter((u) => u.active_flag !== false)
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));

    res.statusCode = 200;
    res.end(JSON.stringify({
      demo: false, generatedAt: new Date(nowMs).toISOString(),
      projects: projectsRaw.map(slimProject),
      tasks: (tasksRaw || []).map(slimTask),
      boards: (boardsRaw || []).map((b) => ({ id: b.id, name: b.name })),
      phases: (phasesRaw || []).map((p) => ({ id: p.id, name: p.name, board_id: p.board_id })),
      users,
    }));
  } catch (err) {
    // En cas d'erreur (Projects non activé, token sans accès, endpoint différent), on montre la démo
    // plutôt qu'une page cassée — on affinera le branchement à ce moment-là.
    sendDemo('error');
  }
};
