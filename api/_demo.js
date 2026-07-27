// Jeu de démonstration reproduisant la vraie structure :
//  - prospects (contacts) avec un champ "résultat d'appel" (CE = "Contact établi")
//  - affaires multi-pipelines (VPA Bordeaux / VPA La Réunion) avec un champ date "règlement mandat"
//  - plusieurs commerciaux (users) pour tester le filtre
// Utilisé tant que le mapping des vrais champs n'est pas configuré.

const DEMO_USERS = [
  { id: 101, name: 'Camille Robert' },
  { id: 102, name: 'Yanis Moreau' },
  { id: 103, name: 'Sophie Da Silva' },
];

const DEMO_MAPPING = {
  mandatValue: 500,
  pipelines: [],
  mandatDateField: 'mandat_date',
  ceSource: 'person',
  ceField: 'call_result',
  ceValues: ['21'],          // id d'option "Contact établi"
  ceActivityTypes: [],
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
  const pickUser = () => DEMO_USERS[Math.floor(rnd() * DEMO_USERS.length)].id;

  const pipelines = [
    { id: 1, name: 'VPA Bordeaux' },
    { id: 7, name: 'VPA La Réunion' },
  ];

  // ---- Prospects (contacts) sur ~13 mois ----
  const persons = [];
  let pid = 1;
  for (let d = 395; d >= 0; d--) {
    const dayMs = nowMs - d * DAY;
    const dow = new Date(dayMs).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const created = 2 + Math.floor(rnd() * 5);
    for (let i = 0; i < created; i++) {
      const r = rnd();
      const result = r < 0.45 ? 21 : r < 0.7 ? 22 : r < 0.9 ? 23 : 0; // 45% Contact établi
      persons.push({
        id: pid++,
        add_time: iso(dayMs - Math.floor(rnd() * 6) * 3600000),
        owner_id: pickUser(),
        custom_fields: result ? { call_result: result } : {},
      });
    }
  }

  // ---- Affaires sur 12 mois, réparties sur 2 pipelines ----
  const deals = [];
  let id = 1;
  for (let m = 11; m >= 0; m--) {
    const monthBase = nowMs - m * 30 * DAY;
    const created = 16 + Math.floor(rnd() * 10);
    for (let i = 0; i < created; i++) {
      const addMs = monthBase + Math.floor(rnd() * 28) * DAY;
      const pipeline_id = rnd() < 0.65 ? 1 : 7;
      const value = Math.round((rnd() * 8000 + 4000) / 100) * 100;
      const deal = {
        id: id++, title: `Affaire ${id}`, value, currency: 'EUR',
        pipeline_id, owner_id: pickUser(), add_time: iso(addMs), custom_fields: {},
      };
      const gotMandat = rnd() < 0.55;
      if (gotMandat) {
        const mandatMs = addMs + Math.floor(rnd() * 12 + 2) * DAY;
        deal.custom_fields.mandat_date = isoDate(mandatMs);
        const outcome = rnd();
        if (outcome < 0.55) {
          const wonMs = mandatMs + Math.floor(rnd() * 40 + 10) * DAY;
          if (wonMs <= nowMs) { deal.status = 'won'; deal.won_time = iso(wonMs); } else deal.status = 'open';
        } else if (outcome < 0.72) {
          const lostMs = mandatMs + Math.floor(rnd() * 30 + 10) * DAY;
          if (lostMs <= nowMs) { deal.status = 'lost'; deal.lost_time = iso(lostMs); } else deal.status = 'open';
        } else deal.status = 'open';
      } else {
        if (rnd() < 0.5) {
          const lostMs = addMs + Math.floor(rnd() * 25 + 5) * DAY;
          if (lostMs <= nowMs) { deal.status = 'lost'; deal.lost_time = iso(lostMs); } else deal.status = 'open';
        } else deal.status = 'open';
      }
      if (!deal.status) deal.status = 'open';
      deals.push(deal);
    }
  }

  return { pipelines, persons, deals, activities: [], leads: [], users: DEMO_USERS, mapping: DEMO_MAPPING };
}

module.exports = { buildDemo, DEMO_MAPPING };
