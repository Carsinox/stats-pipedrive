// Jeu de démonstration reproduisant la vraie structure :
//  - prospects (LEADS) avec un champ "résultat d'appel" (CE = "Contact établi")
//  - affaires (DEALS) multi-pipelines, certaines issues d'un lead (même personne/titre),
//    avec le même champ "résultat d'appel" + un champ date "règlement mandat"
//  - plusieurs commerciaux (users)
// Sert d'aperçu tant que le mapping des vrais champs n'est pas configuré.

const DEMO_USERS = [
  { id: 101, name: 'Camille Robert' },
  { id: 102, name: 'Yanis Moreau' },
  { id: 103, name: 'Sophie Da Silva' },
];

const DEMO_MAPPING = {
  mandatValue: 500,
  pipelines: [],
  mandatDateField: 'mandat_date',
  ceField: 'call_result',
  ceValues: ['21'],          // id d'option "Contact établi"
};

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function buildDemo(nowMs) {
  const rnd = seeded(7);
  const DAY = 86400000;
  const iso = (ms) => new Date(Math.min(ms, nowMs)).toISOString();
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const pickUser = () => DEMO_USERS[Math.floor(rnd() * DEMO_USERS.length)].id;

  const pipelines = [
    { id: 1, name: 'VPA Bordeaux' },
    { id: 7, name: 'VPA La Réunion' },
  ];

  // ---- Prospects (leads) sur ~13 mois ----
  const leads = [];
  let lid = 1;
  for (let d = 395; d >= 0; d--) {
    const dayMs = nowMs - d * DAY;
    const dow = new Date(dayMs).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const created = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < created; i++) {
      const r = rnd();
      const result = r < 0.45 ? 21 : r < 0.7 ? 22 : 23;
      const owner = pickUser();
      leads.push({
        id: lid,
        person_id: 5000 + lid,
        title: `Prospect ${lid}`,
        owner_id: owner,
        add_time: iso(dayMs),
        update_time: iso(dayMs + Math.floor(rnd() * 3) * DAY),
        custom_fields: { call_result: result },
      });
      lid++;
    }
  }
  const ceLeads = leads.filter((l) => l.custom_fields.call_result === 21);

  // ---- Affaires sur 12 mois ----
  const deals = [];
  let id = 1;
  for (let m = 11; m >= 0; m--) {
    const monthBase = nowMs - m * 30 * DAY;
    const created = 16 + Math.floor(rnd() * 10);
    for (let i = 0; i < created; i++) {
      const addMs = monthBase + Math.floor(rnd() * 28) * DAY;
      let pipeline_id = rnd() < 0.65 ? 1 : 7;
      let owner = pickUser();
      let person_id = null, title = `Affaire ${id}`, call_result;

      const link = rnd();
      if (link < 0.4 && ceLeads.length) {
        // Affaire issue d'un prospect CE existant -> même personne/titre + résultat copié (DOUBLON à dédupliquer)
        const L = ceLeads[Math.floor(rnd() * ceLeads.length)];
        person_id = L.person_id; title = L.title; owner = L.owner_id; call_result = 21;
      } else if (link < 0.55) {
        // CE directement dans l'affaire (sans lead)
        person_id = 90000 + id; call_result = 21;
      }

      const deal = {
        id: id, title, person_id, pipeline_id, owner_id: owner, currency: 'EUR',
        add_time: iso(addMs), update_time: iso(addMs + Math.floor(rnd() * 20) * DAY),
        custom_fields: {},
      };
      if (call_result) deal.custom_fields.call_result = call_result;

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
      } else if (rnd() < 0.5) {
        const lostMs = addMs + Math.floor(rnd() * 25 + 5) * DAY;
        if (lostMs <= nowMs) { deal.status = 'lost'; deal.lost_time = iso(lostMs); } else deal.status = 'open';
      }
      if (!deal.status) deal.status = 'open';
      deals.push(deal);
      id++;
    }
  }

  return { pipelines, leads, deals, users: DEMO_USERS, mapping: DEMO_MAPPING };
}

module.exports = { buildDemo, DEMO_MAPPING };
