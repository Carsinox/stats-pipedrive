// Jeu de démonstration reproduisant la vraie structure :
//  - activités "appel" avec un champ "résultat d'appel" (CE = "Contact établi")
//  - affaires multi-pipelines avec un champ date "règlement mandat"
// Utilisé quand le mapping n'est pas encore configuré, pour voir le rendu tout de suite.

const DEMO_MAPPING = {
  mandatValue: 500,
  pipelines: [],
  mandatDateField: 'mandat_date',
  ceField: 'call_result',
  ceValues: ['21'],           // id d'option "Contact établi"
  ceActivityTypes: ['call'],
};

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function buildDemo(nowMs) {
  const rnd = seeded(7);
  const DAY = 86400000;
  const iso = (ms) => new Date(ms).toISOString();
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

  const pipelines = [
    { id: 1, name: 'Achat véhicule' },
    { id: 2, name: 'Reprise' },
  ];

  // ---- Activités (appels) sur ~13 mois ----
  const activities = [];
  let aid = 1;
  for (let d = 395; d >= 0; d--) {
    const dayMs = nowMs - d * DAY;
    const dow = new Date(dayMs).getUTCDay();
    if (dow === 0 || dow === 6) continue; // pas d'appels le week-end
    const calls = 6 + Math.floor(rnd() * 10);
    for (let i = 0; i < calls; i++) {
      const r = rnd();
      // 35% "Contact établi" (id 21), sinon autres résultats.
      const result = r < 0.35 ? 21 : r < 0.6 ? 22 : r < 0.85 ? 23 : 24;
      activities.push({
        id: aid++,
        type: 'call',
        done: true,
        marked_as_done_time: iso(dayMs - Math.floor(rnd() * 8) * 3600000),
        custom_fields: { call_result: result },
      });
    }
    // quelques emails (ne comptent pas comme CE)
    for (let i = 0; i < 3; i++) {
      activities.push({ id: aid++, type: 'email', done: true, marked_as_done_time: iso(dayMs), custom_fields: {} });
    }
  }

  // ---- Affaires sur 12 mois, réparties sur 2 pipelines ----
  const deals = [];
  let id = 1;
  for (let m = 11; m >= 0; m--) {
    const monthBase = nowMs - m * 30 * DAY;
    const created = 18 + Math.floor(rnd() * 10);
    for (let i = 0; i < created; i++) {
      const addMs = monthBase + Math.floor(rnd() * 28) * DAY;
      const pipeline_id = rnd() < 0.7 ? 1 : 2;
      const value = Math.round((rnd() * 8000 + 4000) / 100) * 100;
      const deal = {
        id: id++, title: `Affaire ${id}`, value, currency: 'EUR',
        pipeline_id, add_time: iso(addMs), custom_fields: {},
      };

      const gotMandat = rnd() < 0.55; // 55% signent un mandat
      if (gotMandat) {
        const mandatMs = addMs + Math.floor(rnd() * 12 + 2) * DAY;
        deal.custom_fields.mandat_date = isoDate(mandatMs);
        const outcome = rnd();
        if (outcome < 0.55) {
          // facturé (gagné)
          const wonMs = mandatMs + Math.floor(rnd() * 40 + 10) * DAY;
          if (wonMs <= nowMs) { deal.status = 'won'; deal.won_time = iso(wonMs); }
          else { deal.status = 'open'; }
        } else if (outcome < 0.72) {
          // remboursé (perdu avec date mandat)
          const lostMs = mandatMs + Math.floor(rnd() * 30 + 10) * DAY;
          if (lostMs <= nowMs) { deal.status = 'lost'; deal.lost_time = iso(lostMs); }
          else { deal.status = 'open'; }
        } else {
          // en cours = potentiel
          deal.status = 'open';
        }
      } else {
        // pas de mandat : soit en cours tôt, soit "pas de projet" (perdu sans date mandat)
        if (rnd() < 0.5) {
          const lostMs = addMs + Math.floor(rnd() * 25 + 5) * DAY;
          if (lostMs <= nowMs) { deal.status = 'lost'; deal.lost_time = iso(lostMs); }
          else deal.status = 'open';
        } else {
          deal.status = 'open';
        }
      }
      if (!deal.status) deal.status = 'open';
      deals.push(deal);
    }
  }

  return { pipelines, activities, deals, mapping: DEMO_MAPPING };
}

module.exports = { buildDemo, DEMO_MAPPING };
