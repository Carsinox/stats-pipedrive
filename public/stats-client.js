// Moteur de calcul CÔTÉ NAVIGATEUR (copie de api/_stats.js).
// Permet de refiltrer instantanément (commercial / pipeline / jour-semaine-mois)
// sans rappeler Pipedrive : les données brutes sont chargées une seule fois.
(function () {
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  function monthKey(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; }
  function isoWeek(d) {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((date - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return `${date.getUTCFullYear()}-W${pad(week)}`;
  }
  function parseTs(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
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
    for (const ts of events) { if (!ts) continue; const k = keyOf(ts, gran); if (counts.has(k)) counts.set(k, counts.get(k) + 1); }
    return range.map((k) => counts.get(k));
  }
  function countInCurrent(events, nowMs, gran) {
    const wanted = keyOf(new Date(nowMs), gran);
    let n = 0; for (const ts of events) if (ts && keyOf(ts, gran) === wanted) n++; return n;
  }
  function ownerOf(entity) {
    const o = entity && (entity.owner_id !== undefined ? entity.owner_id : entity.user_id);
    if (o == null) return null;
    if (typeof o === 'object') return Number(o.id != null ? o.id : o.value);
    return Number(o);
  }
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
    cands.forEach((c, i) => { const r = find(i); const cur = groupMin.get(r); if (cur === undefined || c.t < cur) groupMin.set(r, c.t); });
    return [...groupMin.values()];
  }

  function computeStats(data, mapping, opts) {
    const deals = data.deals || [], activities = data.activities || [], persons = data.persons || [], leads = data.leads || [], pipelines = data.pipelines || [];
    const nowMs = opts.nowMs;
    const gran = opts.gran || 'month';
    const mv = mapping.mandatValue || 500;
    const ownerId = opts.ownerId ? Number(opts.ownerId) : null;

    const pipeFilter = (mapping.pipelines && mapping.pipelines.length) ? new Set(mapping.pipelines.map(Number)) : null;
    const inScope = (d) => !pipeFilter || pipeFilter.has(Number(d.pipeline_id));
    const ownedBy = (e) => !ownerId || ownerOf(e) === ownerId;

    const dScoped = deals.filter((d) => d.status !== 'deleted' && inScope(d) && ownedBy(d));

    // CE = "Contact établi" sur le PROSPECT (lead) OU sur l'AFFAIRE, daté à la dernière
    // mise à jour, dédupliqué (même personne / même titre = 1 seul CE).
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
      for (const l of leads) collect(l);
      for (const d of dScoped) collect(d);
      ceGroupTimes(cands).forEach((t) => ceEvents.push(new Date(t)));
    }

    const r2Events = dScoped.map((d) => parseTs(d.add_time)).filter(Boolean);
    const mandatDeals = dScoped.filter((d) => parseTs(getCF(d, mapping.mandatDateField)));
    const mandatEvents = mandatDeals.map((d) => parseTs(getCF(d, mapping.mandatDateField)));

    const per = (events) => ({ day: countInCurrent(events, nowMs, 'day'), week: countInCurrent(events, nowMs, 'week'), month: countInCurrent(events, nowMs, 'month') });
    const ce = per(ceEvents), r2 = per(r2Events), mandats = per(mandatEvents);
    const tauxTransfo = ce.month > 0 ? mandats.month / ce.month : null;

    const curMonth = monthKey(new Date(nowMs));
    const wonThisMonth = dScoped.filter((d) => { if (d.status !== 'won') return false; const wt = parseTs(d.won_time); return wt && monthKey(wt) === curMonth; });
    const caGagneMonth = wonThisMonth.length * mv;
    const potentielDeals = mandatDeals.filter((d) => d.status === 'open');
    const potentiel = potentielDeals.length * mv;
    const rembMonthDeals = mandatDeals.filter((d) => { if (d.status !== 'lost') return false; const lt = parseTs(d.lost_time); return lt && monthKey(lt) === curMonth; });
    const remboursementsMonth = rembMonthDeals.length * mv;

    const trend = {
      labels: buildRange(nowMs, gran),
      ce: seriesFromEvents(ceEvents, nowMs, gran),
      r2: seriesFromEvents(r2Events, nowMs, gran),
      mandats: seriesFromEvents(mandatEvents, nowMs, gran),
    };

    const months = buildRange(nowMs, 'month');
    const caByMonth = new Map(months.map((m) => [m, 0]));
    const rembByMonth = new Map(months.map((m) => [m, 0]));
    dScoped.forEach((d) => {
      if (d.status === 'won') { const wt = parseTs(d.won_time); if (wt && caByMonth.has(monthKey(wt))) caByMonth.set(monthKey(wt), caByMonth.get(monthKey(wt)) + mv); }
      if (d.status === 'lost' && parseTs(getCF(d, mapping.mandatDateField))) { const lt = parseTs(d.lost_time); if (lt && rembByMonth.has(monthKey(lt))) rembByMonth.set(monthKey(lt), rembByMonth.get(monthKey(lt)) + mv); }
    });
    const finance = { labels: months, ca: months.map((m) => caByMonth.get(m)), remboursements: months.map((m) => rembByMonth.get(m)) };

    return {
      mandatValue: mv, gran,
      kpis: { ce, r2, mandats, tauxTransfo, caGagneMonth, wonCountMonth: wonThisMonth.length, potentiel, potentielCount: potentielDeals.length, remboursementsMonth, remboursementsCount: rembMonthDeals.length },
      trend, finance,
    };
  }

  window.PDStats = { computeStats };
})();
