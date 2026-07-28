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
      // Déduplication uniquement par personne liée (pas par titre = modèle de véhicule).
      for (const k of [c.pk]) {
        if (!k) continue;
        if (keyToNode.has(k)) union(i, keyToNode.get(k));
        else keyToNode.set(k, i);
      }
    });
    const stampedMin = new Map(), anyMin = new Map();
    cands.forEach((c, i) => {
      const r = find(i);
      if (anyMin.get(r) === undefined || c.t < anyMin.get(r)) anyMin.set(r, c.t);
      if (c.stamped && (stampedMin.get(r) === undefined || c.t < stampedMin.get(r))) stampedMin.set(r, c.t);
    });
    const out = [];
    for (const r of anyMin.keys()) out.push(stampedMin.has(r) ? stampedMin.get(r) : anyMin.get(r));
    return out;
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
        // Date du CE : champ "Date CE" stampé par l'automatisation (exact), sinon création.
        const stampedTs = mapping.ceDateField ? parseTs(getCF(en, mapping.ceDateField)) : null;
        // Champ Date CE configuré -> comptage STRICT par cette date (comme Pipedrive) ;
        // sinon repli sur la création (démo / champ non configuré).
        const ts = mapping.ceDateField ? stampedTs : parseTs(en.add_time);
        if (!ts) return;
        const pid = personIdOf(en);
        const tt = normTitle(en.title);
        cands.push({ t: ts.getTime(), stamped: !!stampedTs, pk: pid ? 'p:' + pid : null, tk: tt ? 't:' + tt : null });
      };
      for (const l of leads) collect(l);
      for (const d of dScoped) collect(d);
      ceGroupTimes(cands).forEach((t) => ceEvents.push(new Date(t)));
    }

    const r2Events = dScoped.map((d) => parseTs(d.add_time)).filter(Boolean);
    const mandatDeals = dScoped.filter((d) => parseTs(getCF(d, mapping.mandatDateField)));
    const mandatEvents = mandatDeals.map((d) => parseTs(getCF(d, mapping.mandatDateField)));

    // Mois de référence : soit le mois choisi dans le filtre (opts.month), soit le mois courant.
    const curMonth = monthKey(new Date(nowMs));
    const refMonth = opts.month || curMonth;
    const monthMode = !!opts.month;
    const cntMonth = (events, mk) => { let n = 0; for (const ts of events) if (ts && monthKey(ts) === mk) n++; return n; };
    const per = (events) => monthMode
      ? { day: null, week: null, month: cntMonth(events, refMonth) }
      : { day: countInCurrent(events, nowMs, 'day'), week: countInCurrent(events, nowMs, 'week'), month: cntMonth(events, curMonth) };
    const ce = per(ceEvents), r2 = per(r2Events), mandats = per(mandatEvents);
    const tauxTransfo = ce.month > 0 ? mandats.month / ce.month : null;

    // Valeur d'un dossier : 250 € si le titre contient "ghost", sinon la valeur de mandat (500 €).
    const dealValue = (d) => /ghost/i.test(d.title || '') ? 250 : mv;
    const sumV = (arr) => arr.reduce((t, d) => t + dealValue(d), 0);

    // Revenus TOTAUX : tous les mandats du mois (date de règlement mandat dans le mois), quel que soit le statut.
    const revTotDeals = mandatDeals.filter((d) => monthKey(parseTs(getCF(d, mapping.mandatDateField))) === refMonth);
    const revenusTotaux = sumV(revTotDeals);
    // Revenus encaissés : affaires gagnées du mois.
    const wonThisMonth = dScoped.filter((d) => { if (d.status !== 'won') return false; const wt = parseTs(d.won_time); return wt && monthKey(wt) === refMonth; });
    const caGagneMonth = sumV(wonThisMonth);
    // Potentiel : affaires EN COURS avec date de règlement mandat (peu importe la date).
    const potentielDeals = mandatDeals.filter((d) => d.status === 'open');
    const potentiel = sumV(potentielDeals);
    // Remboursements du mois : affaires perdues avec date de règlement mandat, perdues ce mois.
    const rembMonthDeals = mandatDeals.filter((d) => { if (d.status !== 'lost') return false; const lt = parseTs(d.lost_time); return lt && monthKey(lt) === refMonth; });
    const remboursementsMonth = sumV(rembMonthDeals);

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
      if (d.status === 'won') { const wt = parseTs(d.won_time); if (wt && caByMonth.has(monthKey(wt))) caByMonth.set(monthKey(wt), caByMonth.get(monthKey(wt)) + dealValue(d)); }
      if (d.status === 'lost' && parseTs(getCF(d, mapping.mandatDateField))) { const lt = parseTs(d.lost_time); if (lt && rembByMonth.has(monthKey(lt))) rembByMonth.set(monthKey(lt), rembByMonth.get(monthKey(lt)) + dealValue(d)); }
    });
    const finance = { labels: months, ca: months.map((m) => caByMonth.get(m)), remboursements: months.map((m) => rembByMonth.get(m)) };

    return {
      mandatValue: mv, gran, monthMode, refMonth,
      kpis: { ce, r2, mandats, tauxTransfo, revenusTotaux, revTotCount: revTotDeals.length, caGagneMonth, wonCountMonth: wonThisMonth.length, potentiel, potentielCount: potentielDeals.length, remboursementsMonth, remboursementsCount: rembMonthDeals.length },
      trend, finance,
    };
  }

  // Liste détaillée des CE comptés pour la période courante (jour/semaine/mois),
  // avec le nom, la date, la source (prospect/affaire) et si la date est stampée.
  function ceDetail(data, mapping, opts) {
    const leads = data.leads || [], deals = data.deals || [];
    const nowMs = opts.nowMs, gran = opts.period || 'month';
    const ownerId = opts.ownerId ? Number(opts.ownerId) : null;
    if (!(mapping.ceField && mapping.ceValues && mapping.ceValues.length)) return [];
    const pipeFilter = (mapping.pipelines && mapping.pipelines.length) ? new Set(mapping.pipelines.map(Number)) : null;
    const inScope = (d) => !pipeFilter || pipeFilter.has(Number(d.pipeline_id));
    const ownedBy = (e) => !ownerId || ownerOf(e) === ownerId;
    const dScoped = deals.filter((d) => d.status !== 'deleted' && inScope(d) && ownedBy(d));
    const cands = [];
    const collect = (en, src) => {
      if (!ownedBy(en)) return;
      if (!matchesCE(getCF(en, mapping.ceField), mapping.ceValues)) return;
      const stampedTs = mapping.ceDateField ? parseTs(getCF(en, mapping.ceDateField)) : null;
      const ts = mapping.ceDateField ? stampedTs : parseTs(en.add_time);
      if (!ts) return;
      const pid = personIdOf(en);
      const tt = normTitle(en.title);
      cands.push({ t: ts.getTime(), stamped: !!stampedTs, pk: pid ? 'p:' + pid : null, tk: tt ? 't:' + tt : null, title: en.title || '(sans nom)', src });
    };
    leads.forEach((l) => collect(l, 'lead'));
    dScoped.forEach((d) => collect(d, 'deal'));
    const parent = cands.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { parent[find(a)] = find(b); };
    const keyToNode = new Map();
    cands.forEach((c, i) => { for (const k of [c.pk]) { if (!k) continue; if (keyToNode.has(k)) union(i, keyToNode.get(k)); else keyToNode.set(k, i); } });
    const groups = new Map();
    cands.forEach((c, i) => {
      const r = find(i);
      let g = groups.get(r);
      if (!g) { g = { anyMin: c.t, stampedMin: c.stamped ? c.t : undefined, title: c.title, inLead: false, inDeal: false }; groups.set(r, g); }
      else { if (c.t < g.anyMin) g.anyMin = c.t; if (c.stamped && (g.stampedMin === undefined || c.t < g.stampedMin)) g.stampedMin = c.t; }
      if (c.src === 'lead') g.inLead = true;
      if (c.src === 'deal') g.inDeal = true;
    });
    const wantKey = keyOf(new Date(nowMs), gran);
    const inSel = (t) => opts.month ? monthKey(new Date(t)) === opts.month : keyOf(new Date(t), gran) === wantKey;
    const out = [];
    for (const g of groups.values()) {
      const t = g.stampedMin !== undefined ? g.stampedMin : g.anyMin;
      if (inSel(t)) out.push({ date: t, stamped: g.stampedMin !== undefined, title: g.title, inLead: g.inLead, inDeal: g.inDeal });
    }
    out.sort((a, b) => b.date - a.date);
    return out;
  }

  // Détail générique par indicateur, pour la période courante (jour/semaine/mois/all).
  function detail(kind, data, mapping, opts) {
    if (kind === 'ce') return ceDetail(data, mapping, opts);
    const deals = data.deals || [];
    const nowMs = opts.nowMs, gran = opts.period || 'month';
    const ownerId = opts.ownerId ? Number(opts.ownerId) : null;
    const pipeFilter = (mapping.pipelines && mapping.pipelines.length) ? new Set(mapping.pipelines.map(Number)) : null;
    const inScope = (d) => !pipeFilter || pipeFilter.has(Number(d.pipeline_id));
    const ownedBy = (e) => !ownerId || ownerOf(e) === ownerId;
    const dScoped = deals.filter((d) => d.status !== 'deleted' && inScope(d) && ownedBy(d));
    const curKey = gran === 'all' ? null : keyOf(new Date(nowMs), gran);
    // Si un mois est sélectionné (opts.month), tout est filtré sur ce mois.
    const inBucket = (ms) => ms != null && (opts.month ? monthKey(new Date(ms)) === opts.month : (gran === 'all' || keyOf(new Date(ms), gran) === curKey));
    const mv = mapping.mandatValue || 500;
    const dealValue = (d) => /ghost/i.test(d.title || '') ? 250 : mv;
    const refMonth = opts.month || monthKey(new Date(nowMs));
    const inMonth = (ms) => ms != null && monthKey(new Date(ms)) === refMonth;
    const rows = [];
    for (const d of dScoped) {
      const title = d.title || '(sans nom)';
      const amount = dealValue(d), ghost = /ghost/i.test(d.title || '');
      const md = () => parseTs(getCF(d, mapping.mandatDateField));
      if (kind === 'r2') { const t = parseTs(d.add_time); if (t && inBucket(t.getTime())) rows.push({ date: t.getTime(), title }); }
      else if (kind === 'mandat') { const t = md(); if (t && inBucket(t.getTime())) rows.push({ date: t.getTime(), title, amount, ghost }); }
      else if (kind === 'revtot') { const t = md(); if (t && inMonth(t.getTime())) rows.push({ date: t.getTime(), title, amount, ghost }); }
      else if (kind === 'ca') { if (d.status !== 'won') continue; const t = parseTs(d.won_time); if (t && inMonth(t.getTime())) rows.push({ date: t.getTime(), title, amount, ghost }); }
      else if (kind === 'potentiel') { if (d.status !== 'open') continue; const t = md(); if (t) rows.push({ date: t.getTime(), title, amount, ghost }); }
      else if (kind === 'remboursement') { if (d.status !== 'lost') continue; if (!md()) continue; const t = parseTs(d.lost_time); if (t && inMonth(t.getTime())) rows.push({ date: t.getTime(), title, amount, ghost }); }
    }
    rows.sort((a, b) => b.date - a.date);
    return rows;
  }

  // Classement des commerciaux pour la période (mois courant ou mois sélectionné).
  // Ignore le filtre commercial (c'est un classement de tous), respecte le filtre pipeline.
  function ranking(data, mapping, opts) {
    const deals = data.deals || [], users = data.users || [];
    const nowMs = opts.nowMs;
    const refMonth = opts.month || monthKey(new Date(nowMs));
    const pipeFilter = (mapping.pipelines && mapping.pipelines.length) ? new Set(mapping.pipelines.map(Number)) : null;
    const inScope = (d) => !pipeFilter || pipeFilter.has(Number(d.pipeline_id));
    const nameOf = new Map(users.map((u) => [Number(u.id), u.name]));
    const inMonth = (ms) => ms != null && monthKey(new Date(ms)) === refMonth;
    const M = new Map(), E = new Map();
    for (const d of deals) {
      if (d.status === 'deleted' || !inScope(d)) continue;
      const o = ownerOf(d); if (o == null) continue;
      const md = parseTs(getCF(d, mapping.mandatDateField));
      if (md && inMonth(md.getTime())) M.set(o, (M.get(o) || 0) + 1);
      if (d.status === 'won') { const wt = parseTs(d.won_time); if (wt && inMonth(wt.getTime())) E.set(o, (E.get(o) || 0) + 1); }
    }
    const build = (map) => [...map.entries()]
      .map(([id, count]) => ({ id, name: nameOf.get(id) || ('#' + id), count }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'fr'));
    return { mandats: build(M), encaisses: build(E), refMonth };
  }

  // Suite de 'n' mois (clés 'YYYY-MM') se terminant au mois 'refMonth' inclus.
  function monthsEndingAt(refMonth, n) {
    const parts = String(refMonth).split('-').map(Number);
    const y = parts[0], m = parts[1]; // m = 1..12
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(y, m - 1 - i, 1))));
    return out;
  }

  // Historique de la NOTE du mois (/10) sur 12 mois, pour un commercial donné.
  // Note = moyenne de :
  //   - note mandats  = min(10, mandats × 10/15)        (15 mandats = 10/10)
  //   - note remb     = max(0, (100 − remb/mandats×100) / 10)
  //   - 0 mandat      => note globale 0/10
  function noteTrend(data, mapping, opts) {
    const deals = data.deals || [];
    const nowMs = opts.nowMs;
    const ownerId = opts.ownerId ? Number(opts.ownerId) : null;
    const pipeFilter = (mapping.pipelines && mapping.pipelines.length) ? new Set(mapping.pipelines.map(Number)) : null;
    const inScope = (d) => !pipeFilter || pipeFilter.has(Number(d.pipeline_id));
    const ownedBy = (e) => !ownerId || ownerOf(e) === ownerId;
    const dScoped = deals.filter((d) => d.status !== 'deleted' && inScope(d) && ownedBy(d));

    const refMonth = opts.month || monthKey(new Date(nowMs));
    const labels = monthsEndingAt(refMonth, 12);
    const mand = new Map(labels.map((m) => [m, 0]));
    const remb = new Map(labels.map((m) => [m, 0]));
    for (const d of dScoped) {
      const md = parseTs(getCF(d, mapping.mandatDateField));
      if (md) { const k = monthKey(md); if (mand.has(k)) mand.set(k, mand.get(k) + 1); }
      if (d.status === 'lost' && md) { const lt = parseTs(d.lost_time); if (lt) { const k = monthKey(lt); if (remb.has(k)) remb.set(k, remb.get(k) + 1); } }
    }
    const notes = labels.map((m) => {
      const mandats = mand.get(m), r = remb.get(m);
      const nMand = Math.min(10, mandats * 10 / 15);
      if (mandats <= 0) return { note: 0, mandats: 0, remb: r };
      const nRemb = Math.max(0, (100 - r / mandats * 100) / 10);
      return { note: Math.round((nMand + nRemb) / 2 * 10) / 10, mandats, remb: r };
    });
    return { labels, notes };
  }

  window.PDStats = { computeStats, detail, ranking, noteTrend };
})();
