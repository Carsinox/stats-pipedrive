// POST /api/login  { password }  -> pose le cookie de session si le mot de passe est correct.
const { authRequired, passwordMatches, setSessionCookie } = require('./_auth');

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
    return req.body;
  }
  let s = '';
  await new Promise((r) => { req.on('data', (c) => (s += c)); req.on('end', r); req.on('error', r); });
  try { return JSON.parse(s || '{}'); } catch (_) { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ ok: false })); return; }

  // Aucun mot de passe configuré : accès libre, on considère la connexion réussie.
  if (!authRequired()) { setSessionCookie(res); res.statusCode = 200; res.end(JSON.stringify({ ok: true, open: true })); return; }

  const body = await readBody(req);
  const pw = (body && body.password) ? String(body.password) : '';
  if (passwordMatches(pw)) {
    setSessionCookie(res);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, message: 'Mot de passe incorrect.' }));
  }
};
