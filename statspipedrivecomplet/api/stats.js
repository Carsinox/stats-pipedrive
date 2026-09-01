// Endpoint serverless : GET /api/stats?gran=day|week|month&pipeline=all|<id>&user=all|<id>
// - Pas de token OU mapping incomplet  -> mode démo (données simulées)
// - Sinon -> vraies données Pipedrive (v2), token gardé côté serveur.

const { getConfig, pdGet, pdGetAll, pdGetAllV1 } = require('./_pipedrive');
const { getMapping, isMapped } = require('./_config');
const { computeStats } = require('./_stats');
const { buildDemo } = require('./_demo');

module.exports = async (req, res) => {
  const nowMs = Date.now();
  const url = new URL(req.url, 'http://localhost');
  const gran = ['day', 'week', 'month'].includes(url.searchParams.get('gran')) ? url.searchParams.get('gran') : 'month';
  const pipelineParam = url.searchParams.get('pipeline');
  const userParam = url.searchParams.get('user');
  const ownerId = userParam && userParam !== 'all' ? Number(userParam) : null;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  const cfg = getConfig();
  const mapping = getMapping();
  // Filtre pipeline ponctuel depuis l'UI (surcharge le mapping).
  if (pipelineParam && pipelineParam !== 'all') mapping.pipelines = [Number(pipelineParam)];

  // ---- Mode démo ----
  if (!cfg || !isMapped(mapping)) {
    const demo = buildDemo(nowMs);
    const useMapping = { ...demo.mapping };
    if (pipelineParam && pipelineParam !== 'all') useMapping.pipelines = [Number(pipelineParam)];
    const stats = computeStats(demo, useMapping, { nowMs, gran, ownerId });
    res.statusCode = 200;
    res.end(JSON.stringify({
      demo: true,
      reason: !cfg ? 'no_token' : 'no_mapping',
      generatedAt: new Date(nowMs).toISOString(),
      users: demo.users || [],
      ...stats,
    }));
    return;
  }

  // ---- Mode réel ----  (endpoint historique ; le dashboard utilise désormais /api/data)
  try {
    const hasCE = !!mapping.ceField && mapping.ceValues.length;
    const [pipelines, usersRaw, deals, leads] = await Promise.all([
      pdGetAll('/pipelines'),
      pdGet('/users', {}, 'v1').then((r) => r.data || []).catch(() => []),
      pdGetAll('/deals'),
      hasCE ? pdGetAllV1('/leads') : Promise.resolve([]),
    ]);

    const users = (usersRaw || [])
      .filter((u) => u.active_flag !== false)
      .map((u) => ({ id: u.id, name: u.name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));

    const stats = computeStats({ pipelines, deals, leads }, mapping, { nowMs, gran, ownerId });
    res.statusCode = 200;
    res.end(JSON.stringify({ demo: false, generatedAt: new Date(nowMs).toISOString(), users, ...stats }));
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
