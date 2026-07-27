// Mapping entre TES concepts métier et la structure technique de ton Pipedrive.
// Rempli via des variables d'environnement (idéal pour Vercel) ou, à défaut,
// via un fichier config.json à la racine. Les clés/IDs se récupèrent avec
// `node scripts/discover.js` (voir README).

const fs = require('fs');
const path = require('path');

function fromFile() {
  try {
    const p = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return {};
}

function list(v) {
  if (!v) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

function getMapping() {
  const f = fromFile();
  const e = process.env;
  return {
    // Valeur d'un mandat en euros.
    mandatValue: Number(e.PIPEDRIVE_MANDAT_VALUE || f.mandatValue || 500),

    // Pipelines à inclure (IDs). Vide = tous.
    pipelines: list(e.PIPEDRIVE_PIPELINES).map(Number).filter(Boolean).length
      ? list(e.PIPEDRIVE_PIPELINES).map(Number)
      : (Array.isArray(f.pipelines) ? f.pipelines.map(Number) : []),

    // Affaires — champ personnalisé "date de règlement mandat" (clé API hashée).
    mandatDateField: e.PIPEDRIVE_MANDAT_DATE_FIELD || f.mandatDateField || '',

    // Activités — champ "résultat de l'appel" (clé API hashée) + valeur "Contact établi".
    ceField: e.PIPEDRIVE_CE_FIELD || f.ceField || '',
    // Peut être un ID d'option (nombre) ou le libellé exact. Plusieurs valeurs possibles.
    ceValues: (list(e.PIPEDRIVE_CE_VALUES).length ? list(e.PIPEDRIVE_CE_VALUES)
      : (Array.isArray(f.ceValues) ? f.ceValues : (f.ceValue ? [f.ceValue] : []))),
    // Restreindre aux activités de ces types (ex: "call"). Vide = tous types.
    ceActivityTypes: list(e.PIPEDRIVE_CE_ACTIVITY_TYPES).length
      ? list(e.PIPEDRIVE_CE_ACTIVITY_TYPES)
      : (Array.isArray(f.ceActivityTypes) ? f.ceActivityTypes : []),
  };
}

// Le mapping est-il suffisamment rempli pour interroger les vraies données ?
function isMapped(m) {
  return Boolean(m.mandatDateField && m.ceField && m.ceValues.length);
}

module.exports = { getMapping, isMapped };
