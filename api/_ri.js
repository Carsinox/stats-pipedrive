// Données du "Service RI" (module Pipedrive Projects) : démo + normalisation.
// Répartition par le CHAMP PERSONNALISÉ "Relation Garage" (jamais le propriétaire).
// Unité statistique = le PROJET (jamais l'affaire ; une affaire peut avoir plusieurs projets).
//
// L'API Projects n'exposant PAS l'historique des phases, les KPI "de passage" (BDC du jour,
// Paiement total, délai A relancer -> Contrôle 1) reposent sur des CHAMPS DATE tamponnés par
// des automatisations Pipedrive : date_bdc, date_arelancer, date_ctrl1, date_paiement.

const RI_COLLABS = ['Aurore', 'Geraldine', 'Lea', 'Mathilde', 'Thomas', 'John'];

// Étapes (ordre logique). En réel, on retrouve ces étapes par leur nom via un matcher.
const RI_PHASES = [
  { id: 1, name: 'Attente attribution' },
  { id: 2, name: 'Validation garage' },
  { id: 3, name: 'A relancer' },
  { id: 4, name: 'Contrôle 1 terminé' },
  { id: 5, name: 'BDC à signer' },
  { id: 6, name: 'Attente Docs CPI' },
  { id: 7, name: 'TUV à relancer' },
  { id: 8, name: 'Paiement total' },
];

function seeded(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

function buildRiDemo(nowMs) {
  const rnd = seeded(23);
  const DAY = 86400000, HOUR = 3600000;
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const isoDT = (ms) => new Date(ms).toISOString();

  const projects = [];
  let pid = 1, dealId = 1000;

  for (let m = 11; m >= 0; m--) {
    const monthBase = nowMs - m * 30 * DAY;
    const nDeals = 4 + Math.floor(rnd() * 4);
    for (let dd = 0; dd < nDeals; dd++) {
      dealId++;
      const projPerDeal = 1 + (rnd() < 0.35 ? (rnd() < 0.5 ? 1 : 2) : 0); // parfois 2-3 projets / affaire
      for (let k = 0; k < projPerDeal; k++) {
        const startMs = monthBase + Math.floor(rnd() * 26) * DAY;
        const ri = RI_COLLABS[Math.floor(rnd() * RI_COLLABS.length)];
        const aged = (nowMs - startMs) / DAY;

        // Progression : plus le projet est ancien, plus il avance dans les étapes.
        let ord;
        if (aged < 5) ord = 0;
        else if (aged < 12) ord = 1;
        else if (aged < 22) ord = 2 + Math.floor(rnd() * 2);
        else ord = Math.min(7, 2 + Math.floor(rnd() * 6));

        let status = 'open';
        const cf = {};
        // Dates tamponnées cohérentes avec la progression
        let tMs = startMs + (2 + Math.floor(rnd() * 4)) * DAY;
        if (ord >= 2) { cf.date_arelancer = isoDT(tMs); }
        if (ord >= 3) { tMs += (18 + Math.floor(rnd() * 60)) * HOUR; cf.date_ctrl1 = isoDT(tMs); } // délai A relancer->Ctrl1
        if (ord >= 4) { tMs += (1 + Math.floor(rnd() * 3)) * DAY; cf.date_bdc = isoDT(tMs); }
        if (ord >= 7) { tMs += (2 + Math.floor(rnd() * 6)) * DAY; cf.date_paiement = isoDT(tMs); status = 'completed'; }

        // Quelques BDC tamponnés AUJOURD'HUI (pour la colonne "BDC du jour")
        if (ord >= 4 && rnd() < 0.06) cf.date_bdc = isoDT(nowMs - Math.floor(rnd() * 6) * HOUR);

        // Annulations : certaines après "A relancer" (comptent), d'autres avant (ne comptent pas)
        if (rnd() < 0.13) { status = 'canceled'; if (rnd() < 0.5 && ord < 2) ord = Math.floor(rnd() * 2); }

        cf.relation_garage = ri;
        // Dernière mise à jour : récente pour les projets ouverts (certains > 24 h => "en retard"),
        // plus ancienne pour les terminés/annulés. Sert au "Délai moyen" (now - update_time).
        const updMs = status === 'open'
          ? nowMs - Math.floor(rnd() * 96) * HOUR
          : nowMs - (5 + Math.floor(rnd() * 35)) * DAY;
        projects.push({
          id: pid, title: `Mandat #${dealId}-${k + 1}`, deal_ids: [dealId],
          status, phase_id: RI_PHASES[ord].id, board_id: 1,
          owner_id: 999, // volontairement un "propriétaire" neutre : on ne l'utilise JAMAIS
          start_date: isoDate(startMs), end_date: isoDate(startMs + (30 + Math.floor(rnd() * 40)) * DAY),
          update_time: isoDT(updMs),
          custom_fields: cf,
        });
        pid++;
      }
    }
  }

  return {
    projects, phases: RI_PHASES, boards: [{ id: 1, name: 'VPA Mandats' }],
    collaborators: RI_COLLABS,
    riField: 'relation_garage',
    dateFields: { bdc: 'date_bdc', arelancer: 'date_arelancer', ctrl1: 'date_ctrl1', paiement: 'date_paiement' },
  };
}

module.exports = { buildRiDemo, RI_COLLABS, RI_PHASES };
