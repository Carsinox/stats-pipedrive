// POST/GET /api/logout -> efface le cookie de session.
const { clearSessionCookie } = require('./_auth');

module.exports = async (req, res) => {
  clearSessionCookie(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
};
