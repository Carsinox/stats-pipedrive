// Helper partagé pour appeler l'API Pipedrive.
// Le token n'est JAMAIS exposé au navigateur : il reste côté serveur (variable d'env).
// Données : API v2. Définitions de champs : endpoints /v1 (toujours actifs, seuls les
// endpoints de DONNÉES v1 sont retirés le 31/07/2026 — les *Fields le restent).

const MAX_PAGES = 80;      // garde-fou : 80 * 500 = 40 000 enregistrements max
const PAGE_LIMIT = 500;

function cleanDomain(raw) {
  return String(raw || '')
    .replace(/^https?:\/\//, '')
    .replace(/\.pipedrive\.com.*$/, '')
    .replace(/\/.*$/, '')
    .trim();
}

function getConfig() {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  const domain = cleanDomain(process.env.PIPEDRIVE_DOMAIN);
  if (!domain || !token) return null;
  return {
    token,
    base: (v) => `https://${domain}.pipedrive.com/api/${v}`,
  };
}

async function pdGet(path, params = {}, version = 'v2') {
  const cfg = getConfig();
  if (!cfg) throw new Error('NOT_CONFIGURED');
  const url = new URL(cfg.base(version) + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { 'x-api-token': cfg.token, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Pipedrive ${res.status} ${path}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Pagination v2 par curseur.
async function pdGetAll(path, params = {}) {
  let cursor = null;
  let out = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await pdGet(path, { ...params, limit: PAGE_LIMIT, cursor }, 'v2');
    if (Array.isArray(page.data)) out = out.concat(page.data);
    cursor = page.additional_data && page.additional_data.next_cursor;
    if (!cursor) break;
  }
  return out;
}

// Pagination v1 par start/limit (utilisée pour les définitions de champs).
async function pdGetAllV1(path, params = {}) {
  let start = 0;
  let out = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await pdGet(path, { ...params, start, limit: PAGE_LIMIT }, 'v1');
    if (Array.isArray(page.data)) out = out.concat(page.data);
    const more = page.additional_data && page.additional_data.pagination;
    if (more && more.more_items_in_collection) start = more.next_start;
    else break;
  }
  return out;
}

module.exports = { getConfig, cleanDomain, pdGet, pdGetAll, pdGetAllV1 };
