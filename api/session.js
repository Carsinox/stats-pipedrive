// GET /api/session -> indique si l'utilisateur est connecté et si un mot de passe est requis.
const { isAuthed, authRequired } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.end(JSON.stringify({ authed: isAuthed(req), required: authRequired() }));
};
