// Tests des calculs métier (fonctions pures) — sans réseau.
const assert = require('assert');
const { computeStats } = require('../api/_stats');
const { buildDemo } = require('../api/_demo');

const NOW = Date.UTC(2026, 6, 15); // mer. 15 juillet 2026
const MAP = {
  mandatValue: 500, pipelines: [],
  mandatDateField: 'md', ceField: 'cr', ceValues: ['21'], ceActivityTypes: ['call'],
};
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ✓', name); };
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 10)).toISOString();

const activities = [
  { id: 1, type: 'call', done: true, marked_as_done_time: iso(2026, 7, 3), custom_fields: { cr: 21 } },
  { id: 2, type: 'call', done: true, marked_as_done_time: iso(2026, 7, 9), custom_fields: { cr: 21 } },
  { id: 3, type: 'call', done: true, marked_as_done_time: iso(2026, 7, 14), custom_fields: { cr: 21 } },
  { id: 4, type: 'call', done: true, marked_as_done_time: iso(2026, 7, 10), custom_fields: { cr: 22 } }, // pas CE
  { id: 5, type: 'email', done: true, marked_as_done_time: iso(2026, 7, 10), custom_fields: { cr: 21 } }, // mauvais type
  { id: 6, type: 'call', done: false, marked_as_done_time: iso(2026, 7, 10), custom_fields: { cr: 21 } }, // pas fait
];

const deals = [
  { id: 1, pipeline_id: 1, status: 'won', value: 5000, add_time: iso(2026, 7, 5), won_time: iso(2026, 7, 12), custom_fields: { md: '2026-07-08' } },
  { id: 2, pipeline_id: 1, status: 'open', value: 5000, add_time: iso(2026, 7, 6), custom_fields: { md: '2026-07-09' } },
  { id: 3, pipeline_id: 1, status: 'lost', value: 5000, add_time: iso(2026, 7, 7), lost_time: iso(2026, 7, 13), custom_fields: { md: '2026-07-10' } },
  { id: 4, pipeline_id: 1, status: 'open', value: 5000, add_time: iso(2026, 7, 8), custom_fields: {} },
  { id: 5, pipeline_id: 1, status: 'open', value: 5000, add_time: iso(2026, 6, 20), custom_fields: { md: '2026-07-02' } },
  { id: 6, pipeline_id: 2, status: 'won', value: 9000, add_time: iso(2026, 7, 4), won_time: iso(2026, 7, 11), custom_fields: { md: '2026-07-05' } },
];
const pipelines = [{ id: 1, name: 'P1' }, { id: 2, name: 'P2' }];

const s = computeStats({ deals, activities, pipelines }, MAP, { nowMs: NOW, gran: 'month' });

check('CE du mois = appels faits avec résultat Contact établi', () => assert.strictEqual(s.kpis.ce.month, 3));
check('email et appel non-fait exclus du CE', () => assert.ok(s.kpis.ce.month === 3));
check('R2 du mois = affaires créées ce mois', () => assert.strictEqual(s.kpis.r2.month, 5)); // deals 1,2,3,4,6 créés en juillet
check('Mandats du mois = date règlement mandat en juillet', () => assert.strictEqual(s.kpis.mandats.month, 5)); // 1,2,3,5,6
check('Taux de transfo = mandats/CE', () => assert.ok(Math.abs(s.kpis.tauxTransfo - 5 / 3) < 1e-9));
check('CA gagné du mois = affaires facturées × 500', () => assert.strictEqual(s.kpis.caGagneMonth, 2 * 500)); // deals 1,6
check('Potentiel = affaires en cours avec date mandat × 500', () => assert.strictEqual(s.kpis.potentiel, 2 * 500)); // 2,5
check('Remboursements du mois = perdus avec date mandat × 500', () => assert.strictEqual(s.kpis.remboursementsMonth, 1 * 500)); // 3

// ----- filtre pipeline -----
const s1 = computeStats({ deals, activities, pipelines }, { ...MAP, pipelines: [1] }, { nowMs: NOW, gran: 'month' });
check('filtre pipeline 1 : CA ne compte que P1', () => assert.strictEqual(s1.kpis.caGagneMonth, 1 * 500));
check('filtre pipeline 1 : mandats sans le deal P2', () => assert.strictEqual(s1.kpis.mandats.month, 4));

// ----- granularités -----
const sDay = computeStats({ deals, activities, pipelines }, MAP, { nowMs: NOW, gran: 'day' });
check('série jour : 30 points', () => assert.strictEqual(sDay.trend.labels.length, 30));
const sWeek = computeStats({ deals, activities, pipelines }, MAP, { nowMs: NOW, gran: 'week' });
check('série semaine : 12 points', () => assert.strictEqual(sWeek.trend.labels.length, 12));
check('série mois : 12 points + finance', () => {
  assert.strictEqual(s.trend.labels.length, 12);
  assert.strictEqual(s.finance.labels.length, 12);
});

// ----- démo cohérente -----
const demo = buildDemo(NOW);
const ds = computeStats(demo, demo.mapping, { nowMs: NOW, gran: 'month' });
check('démo : CE mensuel > 0', () => assert.ok(ds.kpis.ce.month > 0));
check('démo : potentiel > 0', () => assert.ok(ds.kpis.potentiel > 0));
check('démo : taux de transfo plausible (0-1.5)', () => assert.ok(ds.kpis.tauxTransfo > 0 && ds.kpis.tauxTransfo < 1.5));
check('démo : CA annuel cumulé > 0', () => assert.ok(ds.finance.ca.reduce((a, b) => a + b, 0) > 0));

console.log(`\n${passed} tests passés ✅`);
