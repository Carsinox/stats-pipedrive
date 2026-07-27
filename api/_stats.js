// Calcul des statistiques métier à partir des données brutes Pipedrive (ou démo).
// Fonctions pures -> testables sans réseau.
//
// Définitions (fournies par l'utilisateur) :
//   CE            = activité (appel) dont le champ "résultat d'appel" = "Contact établi"
//   R2            = affaire créée (add_time)
//   Mandat rentré = affaire dont le champ date "règlement mandat" est renseigné (compté à cette date)
//   CA gagné      = nb d'affaires gagnées (facturées) du mois × valeur du mandat (500 €)
//   Potentiel     = affaires EN COURS avec date de règlement mandat × 500 €
//   Remboursement = affaires PERDUES avec date de règlement mandat × 500 € (comptées au lost_time)
//   Taux transfo  = mandats du mois / CE du mois

// ---------- clés de bucket (calendrier UTC) ----------
function pad(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function monthKey(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; }
function isoWeek(d) {
  // Semaine ISO (lundi). Retourne "GGGG-Www".
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7; // lundi=0
  date.setUTCDate(date.getUTCDate() - day + 3); // jeudi de la semaine
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

function parseTs(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  // Champ date "YYYY-MM-DD" ou datetime ISO ou objet {value}.
  if (typeof v === 'object') v = v.value || v.until || null;
  if (!v) return null;
  const s = String(v);
  const d = new Date(s.length === 10 ? s + 'T00:00:00Z' : s);
  return isNaN(d) ? null : d;
}

function getCF(entity, key) {
  if (!entity || !key) return undefined;
  if (entity.custom_fields && entity.custom_fields[key] !== undefined) return entity.custom_fields[key];
  return entity[key];
}

function matchesCE(value, ceValues) {
  if (value === undefined || value === null || value === '') return false;
  const wanted = new Set(ceValues.map((x) => String(x).trim().toLowerCase()));
  const test = (x) => {
    if (x === undefined || x === null) return false;
    if (typeof x === 'object') return test(x.id) || test(x.label) || test(x.value);
    return wanted.has(String(x).trim().toLowerCase());
  };
  if (Array.isArray(value)) return value.some(test);
  return test(value);
}

// ---------- séries temporelles ----------
function buildRange(nowMs, gran) {
  const out = [];
  const d = new Date(nowMs);
  if (gran === 'day') {
    for (let i = 29; i >= 0; i--) out.push(dayKey(new Date(nowMs - i * 86400000)));
  } else if (gran === 'week') {
    for (let i = 11; i >= 0; i--) out.push(isoWeek(new Date(nowMs - i * 7 * 86400000)));
  } else {
    d.setUTCDate(1);
    for (let i = 11; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))));
  }
  return out;
}
function keyOf(date, gran) {
  return gran === 'day' ? dayKey(date) : gran === 'week' ? isoWeek(date) : monthKey(date);
}
function seriesFromEvents(events, nowMs, gran) {
  const range = buildRange(nowMs, gran);
  const counts = new Map(range.map((k) => [k, 0]));
  for (const ts of events) {
    if (!ts) continue;
    const k = keyOf(ts, gran);
    if (counts.has(k)) counts.set(k, counts.get(k) + 1);
  }
  return range.map((k) => ({ key: k, count: counts.get(k) }));
}

// ---------- comptage sur une période courante ----------
function countInCurrent(events, nowMs, gran) {
  const now = new Date(nowMs);
  const wanted = keyOf(now, gran);
  let n = 0;
  for (const ts of events) if (ts && keyOf(ts, gran) === wanted) n++;
  return n;
}

// Récupère l'id du propriétaire (owner), que l'API renvoie un nombre ou un objet.
function ownerOf(entity) {
  const o = entity && (entity.owner_id !== undefined ? entity.owner_id : entity.user_id);
  if (o == null) return null;
  if (typeof o === 'object') return Number(o.id != null ? o.id : o.value);
  return Number(o);
}
// Id de la personne liée (pour dédupliquer lead <-> affaire du même prospect).
function personIdOf(e) {
  const p = e && e.person_id;
  if (p == null) return null;
  if (typeof p === 'object') return Number(p.value != null ? p.value : p.id);
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function normTitle(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// Regroupe des candidats CE qui partagent la même personne OU le même titre
// (union-find), et renvoie le timestamp le plus ancien de chaque groupe.
function ceGroupTimes(cands) {
  const parent = cands.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  const keyToNode = new Map();
  cands.forEach((c, i) => {
    for (const k of [c.pk, c.tk]) {
      if (!k) continue;
      if (keyToNode.has(k)) union(i, keyToNode.get(k));
      else keyToNode.set(k, i);
    }
  });
  const groupMin = new Map();
  cands.forEach((c, i) => {
    const r = find(i);
    const cur = groupMin.get(r);
    if (cur === undefined || c.t < cur) groupMin.set(r, c.t);
  });
  return [...groupMin.values()];
}

function computeStats({ deals = [], activities = [], persons = [], leads = [], pipelines = [] }, mapping, opts) {
  const nowMs = opts.nowMs;
  const gran = opts.gran || 'month';
  const mv = mapping.mandatValue || 500;
  const ownerId = opts.ownerId ? Number(opts.ownerId) : null;

  const pipeFilter = (mapping.pipelines && mapping.pipelines.length) ? new Set(mapping.pipelines.map(Number)) : null;
  const inScope = (d) => !pipeFilter || pipeFilter.has(Number(d.pipeline_id));
  const ownedBy = (e) => !ownerId || ownerOf(e) === ownerId;

  const dScoped = deals.filter((d) => d.status !== 'deleted' && inScope(d) && ownedBy(d));

  // ----- Événements CE -----
  // CE = champ "résultat d'appel = Contact établi", sur le PROSPECT (lead) OU sur l'AFFAIRE.
  // Daté à la dernière mise à jour de la fiche. Déduplication lead <-> affaire (même
  // personne, ou même titre) : un prospect présent aux deux endroits = 1 seul CE.
  const ceEvents = [];
  if (mapping.ceField && mapping.ceValues && mapping.ceValues.length) {
    const cands = [];
    const collect = (en) => {
      if (!ownedBy(en)) return;
      if (!matchesCE(getCF(en, mapping.ceField), mapping.ceValues)) return;
      const ts = parseTs(en.update_time) || parseTs(en.add_time);
      if (!ts) return;
      const pid = personIdOf(en);
      const tt = normTitle(en.title);
      cands.push({ t: ts.getTime(), pk: pid ? 'p:' + pid : null, tk: tt ? 't:' + tt : null });
    };
    for (const l of leads) collect(l);       // prospects (leads)
    for (const d of dScoped) collect(d);      // affaires (scope pipeline + owner)
    ceGroupTimes(cands).forEach((t) => ceEvents.push(new Date(t)));
  }

  // ----- Événements R2 (affaires créées) -----
  const r2Events = dScoped.map((d) => parseTs(d.add_time)).filter(Boolean);

  // ----- Événements Mandat (date règlement mandat) -----
  const mandatDeals = dScoped.filter((d) => parseTs(getCF(d, mapping.mandatDateField)));
  const mandatEvents = mandatDeals.map((d) => parseTs(getCF(d, mapping.mandatDateField)));

  // ----- Agrégats période courante (jour/semaine/mois) -----
  const per = (events) => ({
    day: countInCurrent(events, nowMs, 'day'),
    week: countInCurrent(events, nowMs, 'week'),
    month: countInCurrent(events, nowMs, 'month'),
  });
  const ce = per(ceEvents);
  const r2 = per(r2Events);
  const mandats = per(mandatEvents);

  // ----- Taux de transfo du mois -----
  const tauxTransfo = ce.month > 0 ? mandats.month / ce.month : null;

  // ----- CA gagné du mois (affaires facturées) -----
  const curMonth = monthKey(new Date(nowMs));
  const wonThisMonth = dScoped.filter((d) => d.status === 'won' && (() => {
    const wt = parseTs(d.won_time); return wt && monthKey(wt) === curMonth;
  })());
  const caGagneMonth = wonThisMonth.length * mv;

  // ----- Potentiel à venir : affaires en cours avec date de règlement mandat -----
  const potentielDeals = mandatDeals.filter((d) => d.status === 'open');
  const potentiel = potentielDeals.length * mv;

  // ----- Remboursements du mois : affaires perdues avec date règlement mandat -----
  const rembMonthDeals = mandatDeals.filter((d) => d.status === 'lost' && (() => {
    const lt = parseTs(d.lost_time); return lt && monthKey(lt) === curMonth;
  })());
  const remboursementsMonth = rembMonthDeals.length * mv;

  // ----- Séries pour graphiques -----
  const trend = {
    labels: buildRange(nowMs, gran),
    ce: seriesFromEvents(ceEvents, nowMs, gran).map((x) => x.count),
    r2: seriesFromEvents(r2Events, nowMs, gran).map((x) => x.count),
    mandats: seriesFromEvents(mandatEvents, nowMs, gran).map((x) => x.count),
  };

  // Évolution CA vs remboursements (12 mois).
  const months = buildRange(nowMs, 'month');
  const caByMonth = new Map(months.map((m) => [m, 0]));
  const rembByMonth = new Map(months.map((m) => [m, 0]));
  dScoped.forEach((d) => {
    if (d.status === 'won') {
      const wt = parseTs(d.won_time);
      if (wt && caByMonth.has(monthKey(wt))) caByMonth.set(monthKey(wt), caByMonth.get(monthKey(wt)) + mv);
    }
    if (d.status === 'lost' && parseTs(getCF(d, mapping.mandatDateField))) {
      const lt = parseTs(d.lost_time);
      if (lt && rembByMonth.has(monthKey(lt))) rembByMonth.set(monthKey(lt), rembByMonth.get(monthKey(lt)) + mv);
    }
  });
  const finance = {
    labels: months,
    ca: months.map((m) => caByMonth.get(m)),
    remboursements: months.map((m) => rembByMonth.get(m)),
  };

  // Pipelines proposés dans le menu : restreints à ceux configurés (VPA Bordeaux, VPA La Réunion).
  const pipeList = (pipelines || [])
    .filter((p) => !pipeFilter || pipeFilter.has(Number(p.id)))
    .map((p) => ({ id: p.id, name: p.name }));

  return {
    mandatValue: mv,
    gran,
    pipelines: pipeList,
    kpis: {
      ce, r2, mandats,
      tauxTransfo,
      caGagneMonth,
      wonCountMonth: wonThisMonth.length,
      potentiel,
      potentielCount: potentielDeals.length,
      remboursementsMonth,
      remboursementsCount: rembMonthDeals.length,
    },
    trend,
    finance,
  };
}

module.exports = { computeStats, dayKey, monthKey, isoWeek, matchesCE, parseTs, getCF };
