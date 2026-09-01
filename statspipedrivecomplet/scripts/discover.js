#!/usr/bin/env node
/**
 * Script de découverte Pipedrive.
 *
 * À LANCER CHEZ TOI (ton token reste sur ta machine, rien n'est envoyé ailleurs) :
 *
 *   1) cp .env.example .env   puis renseigne PIPEDRIVE_DOMAIN et PIPEDRIVE_API_TOKEN
 *   2) node scripts/discover.js
 *
 * Il affiche un résumé lisible et écrit le détail complet dans discover-output.json.
 * Copie-colle le RÉSUMÉ (il ne contient aucun secret) pour finaliser la config.
 */
const fs = require('fs');
const path = require('path');

// Charge .env (sans dépendance).
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (_) {}

const { getConfig, pdGet, pdGetAll, pdGetAllV1 } = require('../api/_pipedrive');

function line(n = 60) { return '─'.repeat(n); }
function safe(fn) { return fn().catch((e) => ({ __error: e.message })); }

(async () => {
  if (!getConfig()) {
    console.error('\n⛔ PIPEDRIVE_DOMAIN et/ou PIPEDRIVE_API_TOKEN manquants dans .env\n');
    process.exit(1);
  }

  console.log('\nInterrogation de Pipedrive…\n');

  const [pipelines, stages, dealFields, activityFields, activityTypes] = await Promise.all([
    safe(() => pdGetAll('/pipelines')),
    safe(() => pdGetAll('/stages')),
    safe(() => pdGetAllV1('/dealFields')),
    safe(() => pdGetAllV1('/activityFields')),
    safe(() => pdGet('/activityTypes', {}, 'v1').then((r) => r.data)),
  ]);

  const out = { pipelines, stages, dealFields, activityFields, activityTypes };
  fs.writeFileSync(path.join(__dirname, '..', 'discover-output.json'), JSON.stringify(out, null, 2));

  // ---------- RÉSUMÉ ----------
  console.log(line());
  console.log('PIPELINES  (mets les IDs voulus dans PIPEDRIVE_PIPELINES)');
  console.log(line());
  (Array.isArray(pipelines) ? pipelines : []).forEach((p) =>
    console.log(`  id ${p.id}\t${p.name}`)
  );

  console.log('\n' + line());
  console.log('CHAMPS D\'AFFAIRE de type DATE  (cherche "règlement mandat")');
  console.log(line());
  (Array.isArray(dealFields) ? dealFields : [])
    .filter((f) => ['date', 'daterange'].includes(f.field_type))
    .forEach((f) => console.log(`  key ${f.key}\t${f.name}  [${f.field_type}]`));

  console.log('\n  → renseigne PIPEDRIVE_MANDAT_DATE_FIELD = la "key" du champ règlement mandat');

  console.log('\n' + line());
  console.log('CHAMPS D\'ACTIVITÉ à choix  (cherche "résultat" / "résultat d\'appel")');
  console.log(line());
  (Array.isArray(activityFields) ? activityFields : [])
    .filter((f) => ['enum', 'set'].includes(f.field_type))
    .forEach((f) => {
      console.log(`  key ${f.key}\t${f.name}  [${f.field_type}]`);
      (f.options || []).forEach((o) => console.log(`        option id ${o.id}\t"${o.label}"`));
    });

  console.log('\n  → PIPEDRIVE_CE_FIELD = la "key" du champ résultat d\'appel');
  console.log('  → PIPEDRIVE_CE_VALUES = l\'"option id" (ou le libellé) de "Contact établi"');

  console.log('\n' + line());
  console.log('TYPES D\'ACTIVITÉ  (optionnel : PIPEDRIVE_CE_ACTIVITY_TYPES, ex "call")');
  console.log(line());
  (Array.isArray(activityTypes) ? activityTypes : []).forEach((t) =>
    console.log(`  key_string "${t.key_string}"\t${t.name}`)
  );

  // Signale les erreurs éventuelles (droits, endpoint indisponible…)
  for (const [k, v] of Object.entries(out)) {
    if (v && v.__error) console.log(`\n⚠ ${k} : ${v.__error}`);
  }

  console.log('\n✅ Détail complet écrit dans discover-output.json');
  console.log('   Copie-colle le résumé ci-dessus pour finaliser la configuration.\n');
})().catch((e) => {
  console.error('\n⛔ Erreur :', e.message, '\n');
  process.exit(1);
});
