// Page de configuration dans le navigateur : GET /api/discover
// Affiche pipelines, champs date d'affaire, et TOUS les champs à choix
// (affaire / contact / activité) pour localiser "résultat d'appel = Contact établi",
// avec détection automatique et un bloc de configuration prêt à copier.

const { getConfig, pdGet, pdGetAll, pdGetAllV1 } = require('./_pipedrive');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(bodyHtml) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configuration · Pipedrive</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:860px;margin:0 auto;
    padding:28px 20px 70px;color:#0b0b0b;background:#f9f9f7;line-height:1.5}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 8px}
  .sub{color:#52514e;margin:0 0 18px}
  .card{background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:16px 18px;margin:14px 0;
    box-shadow:0 1px 2px rgba(0,0,0,.05)}
  table{border-collapse:collapse;width:100%;font-size:14px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #eee;vertical-align:top}
  th{color:#52514e;font-weight:600}
  code{background:#f0efec;padding:2px 6px;border-radius:5px;font-size:13px}
  .key{color:#256abf;font-weight:600}
  .ok{color:#0a7a0a;font-weight:600}
  .warn{color:#b06f00}
  pre{background:#0b0b0b;color:#eaeaea;padding:16px;border-radius:10px;overflow:auto;font-size:13px;line-height:1.7}
  .pill{display:inline-block;background:#e7f0fb;color:#256abf;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600}
  .muted{color:#898781}
  a.btn{display:inline-block;margin-top:8px;background:#256abf;color:#fff;text-decoration:none;padding:9px 15px;border-radius:9px;font-size:14px}
</style></head><body>${bodyHtml}</body></html>`;
}

// Cherche un champ à choix contenant une option "Contact établi".
function findCE(fields) {
  for (const f of fields || []) {
    if (!['enum', 'set'].includes(f.field_type)) continue;
    const opt = (f.options || []).find((o) => /contact\s*[ée]tabli/i.test(o.label || ''));
    if (opt) return { field: f, option: opt };
  }
  return null;
}
// Repli : champ dont le NOM évoque "résultat (d'appel)".
function findResultField(fields) {
  return (fields || []).find((f) => ['enum', 'set'].includes(f.field_type) && /r[ée]sultat/i.test(f.name || ''));
}

function choiceTable(fields, detectedKey, detectedOptId) {
  const enums = (fields || []).filter((f) => ['enum', 'set'].includes(f.field_type));
  if (!enums.length) return '<p class="muted">Aucun champ à choix.</p>';
  return enums.map((f) => `
    <p style="margin:8px 0 4px"><span class="key">${esc(f.key)}</span> — <b>${esc(f.name)}</b>${detectedKey && f.key === detectedKey ? ' <span class="ok">← détecté</span>' : ''}</p>
    <table>${(f.options || []).map((o) =>
      `<tr><td>option id <span class="key">${esc(o.id)}</span>${detectedOptId != null && String(o.id) === String(detectedOptId) ? ' <span class="ok">← "Contact établi"</span>' : ''}</td><td>${esc(o.label)}</td></tr>`).join('')}</table>`).join('<hr style="border:none;border-top:1px solid #eee;margin:12px 0">');
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const cfg = getConfig();
  if (!cfg) {
    res.statusCode = 200;
    res.end(page(`<h1>Configuration</h1>
      <p class="sub">Ajoutez d'abord vos identifiants de connexion.</p>
      <div class="card"><p><code>PIPEDRIVE_DOMAIN</code> — le sous-domaine de votre URL Pipedrive.</p>
      <p><code>PIPEDRIVE_API_TOKEN</code> — votre jeton d'API personnel.</p>
      <p class="muted">Une fois ajoutés, redéployez et rechargez cette page.</p></div>`));
    return;
  }

  try {
    const [pipelines, dealFields, personFields, activityFields, activityTypesRaw] = await Promise.all([
      pdGetAll('/pipelines').catch(() => []),
      pdGetAllV1('/dealFields').catch(() => []),
      pdGetAllV1('/personFields').catch(() => []),
      pdGetAllV1('/activityFields').catch(() => []),
      pdGet('/activityTypes', {}, 'v1').then((r) => r.data).catch(() => []),
    ]);

    const dateFields = (dealFields || []).filter((f) => ['date', 'daterange'].includes(f.field_type));

    // --- détection mandat (champ date) ---
    const guessMandat = dateFields.find((f) => /r[èe]glement|r[ée]gl[ée]|mandat/i.test(f.name || ''));

    // --- détection CE : cherche "Contact établi" sur affaire, contact, puis activité ---
    let ce = null, ceSource = '';
    for (const [src, fields] of [['deal', dealFields], ['person', personFields], ['activity', activityFields]]) {
      const hit = findCE(fields);
      if (hit) { ce = hit; ceSource = src; break; }
    }
    // repli sur le nom "résultat"
    if (!ce) {
      for (const [src, fields] of [['deal', dealFields], ['person', personFields], ['activity', activityFields]]) {
        const f = findResultField(fields);
        if (f) { ce = { field: f, option: null }; ceSource = src; break; }
      }
    }

    const suggest =
`PIPEDRIVE_PIPELINES=1,7
PIPEDRIVE_MANDAT_DATE_FIELD=${guessMandat ? guessMandat.key : 'REMPLACER'}
PIPEDRIVE_CE_FIELD=${ce ? ce.field.key : 'REMPLACER'}
PIPEDRIVE_CE_VALUES=${ce && ce.option ? ce.option.id : 'REMPLACER'}
PIPEDRIVE_MANDAT_VALUE=500`;

    const detected = guessMandat && ce && ce.option;
    const rows = (arr, cols) => (arr || []).map((r) => `<tr>${cols.map((c) => `<td>${c(r)}</td>`).join('')}</tr>`).join('');

    const body = `
      <h1>Configuration détectée</h1>
      <p class="sub">Copiez le bloc ci-dessous dans vos variables d'environnement Vercel.</p>

      <div class="card">
        <h2 style="margin-top:0">${detected ? '<span class="ok">✓ Détection automatique réussie</span>' : '<span class="warn">⚠ Détection partielle — repérez à la main les valeurs "REMPLACER" dans les tableaux plus bas</span>'}</h2>
        <pre>${esc(suggest)}</pre>
        ${ce ? `<p class="muted">Champ « résultat d'appel » détecté. Le CE est compté automatiquement sur les <b>leads (prospects) ET les affaires</b>, avec déduplication.</p>` : ''}
        <a class="btn" href="/">← Retour au dashboard</a>
      </div>

      <h2>Pipelines <span class="pill">PIPEDRIVE_PIPELINES (optionnel)</span></h2>
      <div class="card"><table><tr><th>ID</th><th>Nom</th></tr>
        ${rows(pipelines, [(p) => `<span class="key">${esc(p.id)}</span>`, (p) => esc(p.name)])}
      </table><p class="muted">Vide = tous les pipelines.</p></div>

      <h2>Champs date d'affaire <span class="pill">→ règlement mandat</span></h2>
      <div class="card"><table><tr><th>Clé (key)</th><th>Nom</th></tr>
        ${rows(dateFields, [
          (f) => `<span class="key">${esc(f.key)}</span>${guessMandat && f.key === guessMandat.key ? ' <span class="ok">← détecté</span>' : ''}`,
          (f) => esc(f.name)])}
      </table></div>

      <h2>Champs à choix des AFFAIRES / LEADS (prospects) <span class="pill">→ résultat d'appel</span></h2>
      <p class="muted" style="margin:-6px 0 6px">Dans Pipedrive, les leads partagent ces champs avec les affaires. Repère ici « résultat d'appel » et l'option « Contact établi ».</p>
      <div class="card">${choiceTable(dealFields, ce && (ceSource === 'deal') ? ce.field.key : null, ce && ce.option && ceSource === 'deal' ? ce.option.id : null)}</div>

      <h2>Champs à choix des CONTACTS <span class="pill">→ résultat d'appel ?</span></h2>
      <div class="card">${choiceTable(personFields, ceSource === 'person' && ce ? ce.field.key : null, ceSource === 'person' && ce && ce.option ? ce.option.id : null)}</div>

      <h2>Champs à choix des ACTIVITÉS</h2>
      <div class="card">${choiceTable(activityFields, ceSource === 'activity' && ce ? ce.field.key : null, ceSource === 'activity' && ce && ce.option ? ce.option.id : null)}</div>

      <h2>Types d'activité <span class="pill">PIPEDRIVE_CE_ACTIVITY_TYPES</span></h2>
      <div class="card"><table><tr><th>key_string</th><th>Nom</th></tr>
        ${rows(activityTypesRaw, [(t) => `<span class="key">${esc(t.key_string)}</span>`, (t) => esc(t.name)])}
      </table><p class="muted">Utile seulement si le résultat d'appel est sur l'activité.</p></div>
    `;
    res.statusCode = 200;
    res.end(page(body));
  } catch (err) {
    res.statusCode = err.status || 500;
    res.end(page(`<h1>Erreur</h1><div class="card"><p class="warn">${esc(err.message)}</p></div>`));
  }
};
