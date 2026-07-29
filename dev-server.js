// Serveur de développement local (sans Vercel).
// Charge .env s'il existe, sert /public et route /api/stats vers la fonction serverless.
// Lancer :  node dev-server.js   puis ouvrir http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');

// Mini-chargeur .env (pas de dépendance).
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch (_) {}

const dataHandler = require('./api/data');
const projectsHandler = require('./api/projects');
const riHandler = require('./api/ri');
const discoverHandler = require('./api/discover');
const loginHandler = require('./api/login');
const logoutHandler = require('./api/logout');
const sessionHandler = require('./api/session');
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') {
    return dataHandler(req, res);
  }
  if (url.pathname === '/api/projects') {
    return projectsHandler(req, res);
  }
  if (url.pathname === '/api/ri') {
    return riHandler(req, res);
  }
  if (url.pathname === '/api/discover') {
    return discoverHandler(req, res);
  }
  if (url.pathname === '/api/login') {
    return loginHandler(req, res);
  }
  if (url.pathname === '/api/logout') {
    return logoutHandler(req, res);
  }
  if (url.pathname === '/api/session') {
    return sessionHandler(req, res);
  }
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(PUBLIC, path.normalize(file));
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) {
    res.statusCode = 404; res.end('Not found'); return;
  }
  res.setHeader('Content-Type', MIME[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
});

server.listen(PORT, () => {
  const mode = process.env.PIPEDRIVE_API_TOKEN && process.env.PIPEDRIVE_DOMAIN ? 'RÉEL (Pipedrive)' : 'DÉMO (données simulées)';
  console.log(`▶ Dashboard sur http://localhost:${PORT}  —  mode ${mode}`);
});
