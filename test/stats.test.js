// Tests des calculs métier (fonctions pures) — sans réseau.
const assert = require('assert');
const { computeStats } = require('../api/_stats');
const { buildDemo } = require('../api/_demo');

const NOW = Date.UTC(2026, 6, 15); // mer. 15 juillet 2026
const MAP = { mandatValue: 500, pipelines: [], mandatDateField: 'md', ceField: 'cr', ceValues: ['21'] };
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ✓', name); };
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 10)).toISOString();
const pipelines = [{ id: 1, name: 'P1' }, { id: 7, name: 'P7' }];

// ---------- Affaires : R2 / mandats / CA / potentiel / remboursements ----------
const deals = [
  { id: 1, pipeline_id: 1, status: 'won', add_time: iso(2026, 7, 5), won_time: iso(2026, 7, 12), custom_fields: { md: '2026-07-08' } },
  { id: 2, pipeline_id: 1, status: 'open', add_time: iso(2026, 7, 6), custom_fields: { md: '2026-07-09' } },
  { id: 3, pipeline_id: 1, status: 'lost', add_time: iso(2026, 7, 7), lost_time: iso(2026, 7, 13), custom_fields: { md: '2026-07-10' } },
  { id: 4, pipeline_id: 1, status: 'open', add_time: iso(2026, 7, 8), custom_fields: {} },
  { id: 5, pipeline_id: 1, status: 'open', add_time: iso(2026, 6, 20), custom_fields: { md: '2026-07-02' } },
  { id: 6, pipeline_id: 7, status: 'won', add_time: iso(2026, 7, 4), won_time: iso(2026, 7, 11), custom_fields: { md: '2026-07-05' } },
];
const s = computeStats({ deals, pipelines }, MAP, { nowMs: NOW, gran: 'month' });
check('R2 (affaires créées) du mois', () => assert.strictEqual(s.kpis.r2.month, 5));
check('Mandats du mois (date règlement)', () => assert.strictEqual(s.kpis.mandats.month, 5));
check('CA gagné = facturées × 500', () => assert.strictEqual(s.kpis.caGagneMonth, 2 * 500));
check('Potentiel = en cours avec date × 500', () => assert.strictEqual(s.kpis.potentiel, 2 * 500));
check('Remboursements = perdus avec date × 500', () => assert.strictEqual(s.kpis.remboursementsMonth, 1 * 500));

const s1 = computeStats({ deals, pipelines }, { ...MAP, pipelines: [1] }, { nowMs: NOW, gran: 'month' });
check('filtre pipeline 1 : CA', () => assert.strictEqual(s1.kpis.caGagneMonth, 1 * 500));
check('filtre pipeline 1 : mandats', () => assert.strictEqual(s1.kpis.mandats.month, 4));

// ----- sélecteur de mois -----
const sJune = computeStats({ deals, pipelines }, MAP, { nowMs: NOW, gran: 'month', month: '2026-06' });
check('mois sélectionné : R2 de juin (d5 créé en juin)', () => assert.strictEqual(sJune.kpis.r2.month, 1));
check('mois sélectionné : jour/semaine null (valeur mensuelle seule)', () => assert.strictEqual(sJune.kpis.ce.day, null));
check('mois sélectionné : monthMode=true', () => assert.strictEqual(sJune.monthMode, true));

check('séries jour/semaine/mois', () => {
  assert.strictEqual(computeStats({ deals, pipelines }, MAP, { nowMs: NOW, gran: 'day' }).trend.labels.length, 30);
  assert.strictEqual(computeStats({ deals, pipelines }, MAP, { nowMs: NOW, gran: 'week' }).trend.labels.length, 12);
  assert.strictEqual(s.trend.labels.length, 12);
  assert.strictEqual(s.finance.labels.length, 12);
});

// ---------- CE : union LEADS + AFFAIRES, daté update_time, dédupliqué ----------
const leads = [
  // Deux prospects DIFFÉRENTS avec le même titre (modèle de véhicule) -> 2 CE distincts.
  { person_id: 1, title: 'golf 8 r', owner_id: 101, add_time: iso(2026, 7, 3), custom_fields: { cr: 21 } },
  { person_id: 2, title: 'golf 8 r', owner_id: 101, add_time: iso(2026, 7, 9), custom_fields: { cr: 21 } },
  { person_id: 3, title: 'a 250 e', owner_id: 102, add_time: iso(2026, 7, 14), custom_fields: { cr: 21 } },
  { person_id: 4, title: 'x1 20d', owner_id: 102, add_time: iso(2026, 7, 10), custom_fields: { cr: 22 } }, // pas CE
  { person_id: 5, title: 'ancien', owner_id: 101, add_time: iso(2026, 6, 20), custom_fields: { cr: 21 } }, // mois précédent
];
const dealsCE = [
  // affaire issue du prospect person_id 1 (même client) -> fusionnée avec le lead 1
  { id: 10, pipeline_id: 1, status: 'open', person_id: 1, title: 'golf 8 r', owner_id: 101, add_time: iso(2026, 7, 18), update_time: iso(2026, 7, 20), custom_fields: { cr: 21 } },
  // CE présent uniquement dans une affaire (autre client)
  { id: 11, pipeline_id: 1, status: 'open', person_id: 99, title: 'a 250 e', owner_id: 103, add_time: iso(2026, 7, 11), update_time: iso(2026, 7, 11), custom_fields: { cr: 21 } },
];
const sc = computeStats({ deals: dealsCE, leads, pipelines }, MAP, { nowMs: NOW, gran: 'month' });
check('CE dédupliqué par PERSONNE (2 mêmes titres = 2 CE distincts)', () => assert.strictEqual(sc.kpis.ce.month, 4)); // p1(+affaire), p2, p3, p99
const sc101 = computeStats({ deals: dealsCE, leads, pipelines }, MAP, { nowMs: NOW, gran: 'month', ownerId: 101 });
check('CE filtré commercial 101', () => assert.strictEqual(sc101.kpis.ce.month, 2)); // p1(lead+affaire fusionnés), p2
const sc102 = computeStats({ deals: dealsCE, leads, pipelines }, MAP, { nowMs: NOW, gran: 'month', ownerId: 102 });
check('CE filtré commercial 102', () => assert.strictEqual(sc102.kpis.ce.month, 1)); // p3
const sc103 = computeStats({ deals: dealsCE, leads, pipelines }, MAP, { nowMs: NOW, gran: 'month', ownerId: 103 });
check('CE filtré commercial 103 (CE dans affaire seule)', () => assert.strictEqual(sc103.kpis.ce.month, 1)); // p99

// dédup daté au plus ANCIEN : person 1 (lead 07-03) plutôt que l'affaire (07-20)
const scWeek = computeStats({ deals: dealsCE, leads, pipelines }, MAP, { nowMs: NOW, gran: 'week', ownerId: null });
check('total CE sur la fenêtre = 5 (4 juillet + 1 juin)', () => {
  const total = scWeek.trend.ce.reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 5);
});

// ---------- date CE stampée (automatisation) prime sur la création ----------
const MAPd = { ...MAP, ceDateField: 'cedate' };
const leadsD = [
  // prospect importé le 01/07, passé "Contact établi" le 15/07 (champ Date CE stampé)
  { person_id: 20, title: 'Import LBC', owner_id: 101, add_time: iso(2026, 7, 1), custom_fields: { cr: 21, cedate: '2026-07-15' } },
  // créé aujourd'hui, Contact établi, MAIS sans Date CE -> ne doit PAS compter (mode strict)
  { person_id: 21, title: 'Sans Date CE', owner_id: 101, add_time: iso(2026, 7, 15), custom_fields: { cr: 21 } },
];
const scd = computeStats({ deals: [], leads: leadsD, pipelines }, MAPd, { nowMs: NOW, gran: 'day' });
check('CE daté par le champ Date CE (stampé), pas par la création', () => {
  const i15 = scd.trend.labels.indexOf('2026-07-15');
  const i01 = scd.trend.labels.indexOf('2026-07-01');
  assert.strictEqual(scd.trend.ce[i15], 1); // seule la fiche stampée compte, le 15
  assert.strictEqual(i01 === -1 ? 0 : scd.trend.ce[i01], 0);
});
check('mode strict : une fiche sans Date CE ne compte pas', () => {
  assert.strictEqual(scd.kpis.ce.month, 1); // 1 stampée, pas 2
});

// ---------- démo cohérente ----------
const demo = buildDemo(NOW);
const ds = computeStats(demo, demo.mapping, { nowMs: NOW, gran: 'month' });
check('démo : CE mensuel > 0', () => assert.ok(ds.kpis.ce.month > 0));
check('démo : potentiel > 0', () => assert.ok(ds.kpis.potentiel > 0));
check('démo : CA annuel > 0', () => assert.ok(ds.finance.ca.reduce((a, b) => a + b, 0) > 0));
check('démo : filtre commercial réduit le CE', () => {
  const u = demo.users[0].id;
  const dsU = computeStats(demo, demo.mapping, { nowMs: NOW, gran: 'month', ownerId: u });
  assert.ok(dsU.kpis.ce.month <= ds.kpis.ce.month);
});

console.log(`\n${passed} tests passés ✅`);
