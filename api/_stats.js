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

function computeStats({ deals = [], activities = [], persons = [], pipelines = [] }, mapping, opts) {
  const nowMs = opts.nowMs;
  const gran = opts.gran || 'month';
  const mv = mapping.mandatValue || 500;

  const pipeFilter = (mapping.pipelines && mapping.pipelines.length) ? new Set(mapping.pipelines.map(Number)) : null;
  const inScope = (d) => !pipeFilter || pipeFilter.has(Number(d.pipeline_id));

  const dScoped = deals.filter((d) => d.status !== 'deleted' && inScope(d));

  // ----- Événements CE -----
  // Le champ "résultat d'appel = Contact établi" peut vivre sur l'activité (défaut),
  // sur l'affaire ou sur le contact, selon la configuration Pipedrive.
  const ceEvents = [];
  if (mapping.ceField && mapping.ceValues && mapping.ceValues.length) {
    const src = mapping.ceSource || 'activity';
    if (src === 'activity') {
      for (const a of activities) {
        if (a.done === false) continue;
        if (mapping.ceActivityTypes && mapping.ceActivityTypes.length) {
          if (!mapping.ceActivityTypes.map(String).includes(String(a.type))) continue;
        }
        if (!matchesCE(getCF(a, mapping.ceField), mapping.ceValues)) continue;
        const ts = parseTs(a.marked_as_done_time)
          || parseTs(a.due_date ? `${a.due_date}${a.due_time ? 'T' + a.due_time + ':00Z' : ''}` : null)
          || parseTs(a.update_time) || parseTs(a.add_time);
        if (ts) ceEvents.push(ts);
      }
    } else {
      // Source 'deal' ou 'person' : on compte les entités marquées "Contact établi",
      // datées par leur création (meilleure date disponible sans historique de champ).
      const entities = src === 'person' ? persons : dScoped;
      for (const en of entities) {
        if (!matchesCE(getCF(en, mapping.ceField), mapping.ceValues)) continue;
        const ts = parseTs(en.add_time) || parseTs(en.update_time);
        if (ts) ceEvents.push(ts);
      }
    }
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

  return {
    mandatValue: mv,
    gran,
    pipelines: (pipelines || []).map((p) => ({ id: p.id, name: p.name })),
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
