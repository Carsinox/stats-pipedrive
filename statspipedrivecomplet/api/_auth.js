// Authentification simple par mot de passe partagé.
// - Le mot de passe est stocké dans la variable d'environnement SITE_PASSWORD (jamais dans le code).
// - Après connexion, on pose un cookie de session signé (HMAC-SHA256) valable 30 jours.
// - Si SITE_PASSWORD n'est PAS défini, l'authentification est désactivée (le site reste ouvert),
//   ce qui évite de se verrouiller pendant la configuration et garde le mode démo accessible.

const crypto = require('crypto');

const COOKIE = 'vpa_session';
const MAXAGE = 60 * 60 * 24 * 30; // 30 jours (en secondes)

function password() {
  return process.env.SITE_PASSWORD || '';
}
// L'authentification n'est active que si un mot de passe est configuré.
function authRequired() {
  return password().length > 0;
}

// Clé de signature = le mot de passe lui-même (change le mot de passe => déconnecte tout le monde).
function hmac(msg) {
  return crypto.createHmac('sha256', password() || 'vpa-disabled').update(msg).digest('hex');
}

function makeToken() {
  const exp = Date.now() + MAXAGE * 1000;
  return exp + '.' + hmac('vpa|' + exp);
}

function verifyToken(tok) {
  if (!tok || typeof tok !== 'string') return false;
  const i = tok.indexOf('.');
  if (i < 0) return false;
  const exp = tok.slice(0, i);
  const sig = tok.slice(i + 1);
  const expN = Number(exp);
  if (!Number.isFinite(expN) || expN < Date.now()) return false;
  const good = hmac('vpa|' + exp);
  if (sig.length !== good.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
  } catch (_) {
    return false;
  }
}

function parseCookies(req) {
  const h = (req.headers && req.headers.cookie) || '';
  const out = {};
  h.split(';').forEach((p) => {
    const idx = p.indexOf('=');
    if (idx > 0) out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  if (!authRequired()) return true; // pas de mot de passe configuré => accès libre
  return verifyToken(parseCookies(req)[COOKIE]);
}

// Comparaison de mots de passe à temps constant (protège contre les attaques par timing).
function passwordMatches(candidate) {
  const expected = password();
  if (!candidate || candidate.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

function cookieFlags() {
  // Secure seulement en HTTPS (Vercel) ; en dev local (http) on l'omet pour que le cookie passe.
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAXAGE}` + (secure ? '; Secure' : '');
}

function setSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken())}; ${cookieFlags()}`);
}

function clearSessionCookie(res) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (secure ? '; Secure' : ''));
}

module.exports = {
  COOKIE, authRequired, isAuthed, passwordMatches,
  setSessionCookie, clearSessionCookie,
};
