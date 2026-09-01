// Données Projets (module Pipedrive Projects) : démo + normalisation (slim).
// KPI visés : Volume & statut, Durée & retards, Tâches & complétion.
// Remarque API : Projects n'expose pas de date de complétion ni d'historique des phases ;
// on date donc les projets par start_date, et le statut donne l'instantané ouvert/terminé/annulé.

const DEMO_USERS = [
  { id: 101, name: 'Camille Robert' },
  { id: 102, name: 'Yanis Moreau' },
  { id: 103, name: 'Sophie Da Silva' },
];

const DEMO_BOARDS = [{ id: 1, name: 'VPA Mandats' }];
const DEMO_PHASES = [
  { id: 1, name: 'Recherche véhicule', board_id: 1 },
  { id: 2, name: 'Négociation', board_id: 1 },
  { id: 3, name: 'Financement', board_id: 1 },
  { id: 4, name: 'Livraison', board_id: 1 },
];

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function buildProjectsDemo(nowMs) {
  const rnd = seeded(11);
  const DAY = 86400000;
  const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  const pickUser = () => DEMO_USERS[Math.floor(rnd() * DEMO_USERS.length)].id;

  const projects = [];
  const tasks = [];
  let pid = 1, tid = 1;

  for (let m = 11; m >= 0; m--) {
    const monthBase = nowMs - m * 30 * DAY;
    const created = 3 + Math.floor(rnd() * 4); // 3–6 projets / mois
    for (let i = 0; i < created; i++) {
      const startMs = monthBase + Math.floor(rnd() * 26) * DAY;
      const owner = pickUser();
      const durationDays = 20 + Math.floor(rnd() * 45); // 20–65 j prévus
      const endMs = startMs + durationDays * DAY;

      // Statut : la plupart des anciens sont terminés, les récents ouverts, quelques annulés.
      const r = rnd();
      let status, phase_id;
      const aged = (nowMs - startMs) / DAY;
      if (r < 0.12) { status = 'canceled'; phase_id = 1 + Math.floor(rnd() * 4); }
      else if (aged > durationDays + 5 && rnd() < 0.85) { status = 'completed'; phase_id = 4; }
      else { status = 'open'; phase_id = 1 + Math.floor(rnd() * 4); }

      projects.push({
        id: pid, title: `Mandat #${pid}`, status, phase_id, board_id: 1,
        owner_id: owner, start_date: isoDate(startMs), end_date: isoDate(endMs),
        health_status: rnd() < 0.7 ? 'on_track' : (rnd() < 0.5 ? 'at_risk' : 'off_track'),
        label_ids: [], deal_ids: [],
      });

      // Tâches du projet
      const nTasks = 3 + Math.floor(rnd() * 4);
      for (let t = 0; t < nTasks; t++) {
        const dueMs = startMs + Math.floor(rnd() * durationDays) * DAY;
        let done;
        if (status === 'completed') done = true;
        else if (status === 'canceled') done = rnd() < 0.4;
        else done = dueMs < nowMs ? rnd() < 0.7 : rnd() < 0.2;
        tasks.push({
          id: tid, project_id: pid, phase_id, title: `Tâche ${t + 1} · Mandat #${pid}`,
          done, due_date: isoDate(dueMs), assignee_id: owner,
        });
        tid++;
      }
      pid++;
    }
  }

  return { projects, tasks, boards: DEMO_BOARDS, phases: DEMO_PHASES, users: DEMO_USERS };
}

// --- Normalisation des vraies données Pipedrive ---
function idOf(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.id != null ? v.id : v.value;
  return v;
}
function slimProject(p) {
  return {
    id: p.id, title: p.title, status: p.status,
    phase_id: idOf(p.phase_id), board_id: idOf(p.board_id), owner_id: idOf(p.owner_id),
    start_date: p.start_date || null, end_date: p.end_date || null,
    health_status: p.health_status || null,
    label_ids: p.label_ids || [], deal_ids: p.deal_ids || [],
  };
}
function slimTask(t) {
  return {
    id: t.id, project_id: idOf(t.project_id), phase_id: idOf(t.phase_id),
    title: t.title, done: !!(t.done === true || t.done === 1 || t.done === '1'),
    due_date: t.due_date || null, assignee_id: idOf(t.assignee_id != null ? t.assignee_id : t.assigned_to_user_id),
  };
}

module.exports = { buildProjectsDemo, slimProject, slimTask, DEMO_USERS: DEMO_USERS };
