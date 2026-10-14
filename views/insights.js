import { useMemo } from '../vendor/preact-htm.js?v=ae938a762063';
import { html, useState, useEffect, useApi, useChanged, Loading, ErrorBox, StageBadge, TierChip, Icon, Modal, toast, changed, fmtDate, fmtAgo, fmtCount, localDay, navigate } from '../lib/ui.js?v=ae938a762063';
import { api } from '../lib/api.js?v=ae938a762063';
import { ENTITIES, STAGES, ACTIVITY_TYPES, ROLE_GROUPS, VISIT_AREAS, VISIT_PRIORITY, stageLabel, visitScore } from '../schema.js?v=ae938a762063';
import { BarRows, Columns, ChartCard, StatTile, Meter, DataTable, GeoBubbleMap } from '../lib/charts.js?v=ae938a762063';

// Tiers are ordinal: one hue, tier A strongest. Accounts without a tier use the muted gray.
const TIERS = [
  { key: 'A', label: 'Tier A', color: 'var(--tier-1)' },
  { key: 'B', label: 'Tier B', color: 'var(--tier-2)' },
  { key: 'C', label: 'Tier C', color: 'var(--tier-3)' },
  { key: 'Handoff', label: 'Handoff', color: 'var(--tier-4)' },
  { key: 'none', label: 'No tier', color: 'var(--faint)' },
];
const TIER_ORDER = Object.fromEntries(TIERS.map((t, i) => [t.key, i]));
// Six series for the six categorical colors: notes and bookings are not touches.
const ACTIVITY_SERIES = ACTIVITY_TYPES.filter((t) => t !== 'Note' && t !== 'Demo booked').map((t, i) => ({ key: t, label: t, color: `var(--cat-${i + 1})` }));
const ACCENT = [{ key: 'n', label: 'Accounts', color: 'var(--viz-accent)' }];
const SEGMENTS = ENTITIES.companies.fields.find((f) => f.key === 'segment')?.options ?? [];
const ACTIVE = STAGES.map((s) => s.value).filter((s) => !['won', 'lost', 'disqualified', 'nurture'].includes(s));
const AREAS = [...VISIT_AREAS.map((a) => a.name), 'Statewide / unspecified', 'Out of state'];
const tierOf = (a) => a.tier ?? 'none';
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const byTierThenFit = (a, b) => TIER_ORDER[tierOf(a)] - TIER_ORDER[tierOf(b)] || (b.priority ?? -1) - (a.priority ?? -1) || (b.fit ?? -1) - (a.fit ?? -1);

// Counts accounts per group, split by tier. `keys` fixes the row order.
function tierRows(accounts, keyOf, keys, label = (k) => k) {
  const rows = new Map((keys ?? []).map((k) => [k, { key: k, label: label(k), values: {} }]));
  for (const a of accounts) {
    const k = keyOf(a);
    if (k == null) continue;
    if (!rows.has(k)) rows.set(k, { key: k, label: label(k), values: {} });
    const row = rows.get(k);
    row.values[tierOf(a)] = (row.values[tierOf(a)] ?? 0) + 1;
  }
  return [...rows.values()];
}
const usedTiers = (accounts) => TIERS.filter((t) => accounts.some((a) => tierOf(a) === t.key));
const tierTable = (rows, series, first) => ({
  columns: [first, ...series.map((s) => s.label), 'Total'],
  rows: rows.map((r) => [typeof r.label === 'string' ? r.label : r.title ?? r.key, ...series.map((s) => r.values[s.key] ?? 0), series.reduce((n, s) => n + (r.values[s.key] ?? 0), 0)]),
});

const AccountLink = ({ a }) => html`<a href=${`#/companies/${a.id}`}>${a.name}</a>`;
const PersonLinks = ({ people, limit = 3 }) => html`${people.slice(0, limit).map((p, i) => html`${i ? ', ' : ''}<a href=${`#/people/${p.id}`}>${p.name}</a>`)}${people.length > limit ? ` +${people.length - limit}` : ''}`;

function Select({ value, onChange, options, label }) {
  return html`<select class="input" value=${value} aria-label=${label} onChange=${(e) => onChange(e.target.value)}>
    ${options.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
  </select>`;
}

// The action for an account row: work it if it is in the pipeline, otherwise add it;
// accounts with no buyer get a LinkedIn search instead.
function ActCell({ a, findBuyer }) {
  const stop = (e) => e.stopPropagation();
  if (findBuyer) {
    return html`<a class="btn small" href=${`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${a.name} CIO`)}`}
      target="_blank" rel="noopener noreferrer" onClick=${stop}><${Icon} name="external" size=${13} /> Find buyer</a>`;
  }
  if (!a.stage) {
    const add = async (e) => {
      stop(e);
      try { await api.post('/api/companies/bulk', { ids: [a.id], patch: { stage: 'research' } }); toast(`${a.name} added to the pipeline`); changed(); } catch (err) { toast(err, 'error'); }
    };
    return html`<button class="btn small" onClick=${add}><${Icon} name="plus" size=${13} /> Pipeline</button>`;
  }
  return html`<a class="btn small primary" href=${`#/companies/${a.id}`} onClick=${stop}>Work it</a>`;
}

function AccountTable({ columns, rows, empty }) {
  if (!rows.length) return html`<div class="empty">${empty}</div>`;
  return html`<div class="table-wrap"><table class="data">
    <thead><tr>${columns.map((c) => html`<th>${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map((a) => html`<tr key=${a.id} onClick=${(e) => e.target.closest('a') || navigate(`/companies/${a.id}`)}>
      ${columns.map((c, i) => html`<td class=${`${i === 0 ? 'primary' : ''} ${c.wrap ? 'wrap' : ''}`}>${c.render(a)}</td>`)}
    </tr>`)}</tbody>
  </table></div>`;
}

// ---- Prospecting ----------------------------------------------------------------

function Prospecting({ data, filters, set }) {
  const targets = data.accounts.filter((a) => a.tier && (!filters.source || (filters.source === 'Purchased' ? a.source === 'Purchased' : a.source !== 'Purchased')) && (!filters.segment || a.segment === filters.segment) && (!filters.region || a.area === filters.region));
  const tierA = targets.filter((a) => a.tier === 'A');
  const warm = targets.filter((a) => a.connections.length).sort(byTierThenFit);
  const buyers = targets.flatMap((a) => a.buyers);
  const series = usedTiers(targets);

  const segmentRows = tierRows(targets, (a) => a.segment ?? 'Not set', [...SEGMENTS.filter((s) => targets.some((a) => a.segment === s))]);
  const fits = targets.filter((a) => a.priority != null);
  // Reduce rather than spreading hundreds of thousands of arguments into Math.
  const lo = Math.floor(fits.reduce((n,a) => Math.min(n,a.priority),100) / 10);
  const hi = Math.floor(fits.reduce((n,a) => Math.max(n,a.priority),0) / 10);
  const fitColumns = [];
  for (let b = lo; b <= Math.min(hi, 9); b++) {
    const inBucket = fits.filter((a) => Math.min(9, Math.floor(a.priority / 10)) === b);
    fitColumns.push({ key: b, label: `${b * 10}s`, values: Object.fromEntries(series.map((s) => [s.key, inBucket.filter((a) => tierOf(a) === s.key).length])) });
  }
  const roleNames = [...ROLE_GROUPS.map((g) => g.name), 'Other'];
  const roleRows = [
    { key: 'any', label: 'Any buyer contact', values: { n: tierA.filter((a) => a.buyers.length).length } },
    ...roleNames.map((r) => ({ key: r, label: r, values: { n: tierA.filter((a) => a.buyers.some((b) => b.role === r)).length } })),
  ];
  const noBuyer = tierA.filter((a) => !a.buyers.length).sort(byTierThenFit);
  const untouched = targets.filter((a) => (a.tier === 'A' || a.tier === 'B') && !a.last_touch).sort(byTierThenFit).slice(0, 15);
  const scoring = data.purchased_scoring;

  return html`<div>
    ${scoring && html`<section class="card" style="margin-bottom:20px">
      <div class="head"><div><h2>Purchased lead scoring</h2><div class="small muted">Full purchased pool · ${scoring.version} · independent of the filters below</div></div></div>
      <div class="body">
        <div class="kpis">
          <${StatTile} label="Purchased contacts scored" value=${fmtCount(scoring.contacts.scored ?? 0)} sub=${`${fmtCount(scoring.contacts.evaluated ?? 0)} of ${fmtCount(scoring.contacts.total)} evaluated`} />
          <${StatTile} label="Insufficient account data" value=${fmtCount(scoring.contacts.insufficient ?? 0)} sub="Evaluated contacts without a linked account" />
          <${StatTile} label="Purchased accounts scored" value=${fmtCount(scoring.accounts.scored ?? 0)} sub=${`A ${fmtCount(scoring.accounts.tier_a ?? 0)} · B ${fmtCount(scoring.accounts.tier_b ?? 0)} · C ${fmtCount(scoring.accounts.tier_c ?? 0)}`} />
        </div>
        <p class="small muted">${fmtCount(scoring.contacts.missing_fit ?? 0)} contacts use the missing-fit fallback; ${fmtCount(scoring.contacts.missing_title ?? 0)} use the Other role weight because their title is missing. Purchased contacts are potential buyers; confirmed buyer coverage below uses saved relationships.</p>
        <a class="btn small" href="#/people?view=purchased&sort=lead_score&dir=desc">View purchased leads by score</a>
      </div>
    </section>`}
    <div class="insights-filters">
      <${Select} label="Account source" value=${filters.source} onChange=${(v) => set({ source: v })} options=${[['','All sources'],['Purchased','Purchased'],['Other','Other sources']]} />
      <${Select} label="Segment" value=${filters.segment} onChange=${(v) => set({ segment: v })} options=${[['', 'All segments'], ...SEGMENTS.map((s) => [s, s])]} />
      <${Select} label="Area" value=${filters.region} onChange=${(v) => set({ region: v })} options=${[['', 'All areas'], ...AREAS.map((a) => [a, a])]} />
    </div>
    <div class="kpis">
      <${StatTile} label="Target accounts" value=${fmtCount(targets.length)} sub=${series.filter((s) => s.key !== 'none').map((s) => `${s.key} ${fmtCount(targets.filter((a) => a.tier === s.key).length)}`).join(' · ')} />
      <${StatTile} label="Tier A with a buyer contact" value=${`${fmtCount(tierA.length - noBuyer.length)} of ${fmtCount(tierA.length)}`}>
        <${Meter} value=${tierA.length - noBuyer.length} max=${tierA.length} label="Tier A accounts with a buyer contact" />
      <//>
      <${StatTile} label="Warm intro paths" value=${fmtCount(warm.length)} sub="Target accounts where you have a LinkedIn connection" />
      <${StatTile} label="Reachable buyers" value=${`${fmtCount(buyers.filter((b) => b.reachable).length)} of ${fmtCount(buyers.length)}`} sub="Have an email or LinkedIn URL" />
    </div>
    <div class="insights-grid">
      <${ChartCard} title="Targets by segment" subtitle="Click a segment to filter the page"
        table=${tierTable(segmentRows, series, 'Segment')} empty=${!targets.length && 'No target accounts match these filters.'}>
        <${BarRows} rows=${segmentRows} series=${series} selected=${filters.segment} onPick=${(r) => set({ segment: filters.segment === r.key ? '' : r.key })} />
      <//>
      <${ChartCard} title="Priority score distribution" subtitle="Current account priority, in bands of 10"
        table=${{ columns: ['Priority band', ...series.map((s) => s.label)], rows: fitColumns.map((c) => [c.label, ...series.map((s) => c.values[s.key] ?? 0)]) }}
        empty=${!fits.length && 'No priority scores for these accounts.'}>
        <${Columns} columns=${fitColumns} series=${series} />
      <//>
    </div>
    <div class="insights-grid">
      <${ChartCard} title="Buyer coverage across tier A" subtitle=${`Tier A accounts with at least one buyer contact in each role group (${fmtCount(tierA.length)} accounts)`}
        table=${{ columns: ['Role group', 'Accounts', 'Share'], rows: roleRows.map((r) => [r.label, r.values.n, pct(r.values.n, tierA.length)]) }}
        empty=${!tierA.length && 'No tier A accounts match these filters.'}>
        <${BarRows} rows=${roleRows} series=${ACCENT} max=${tierA.length} valueText=${(r, n) => `${fmtCount(n)} · ${pct(n, tierA.length)}`} />
      <//>
      <section class="card">
        <div class="head"><div class="grow"><h2>Warm intro paths</h2><div class="small muted">Your LinkedIn connections at target accounts</div></div><span class="muted small">${warm.length}</span></div>
        <div class="body flush"><${AccountTable} rows=${warm} empty="No connections at these target accounts." columns=${[
          { label: 'Account', render: (a) => html`<${AccountLink} a=${a} />` },
          { label: 'Tier', render: (a) => html`<${TierChip} tier=${a.tier} />` },
          { label: 'Fit', render: (a) => a.fit ?? '' },
          { label: 'Your connections', wrap: true, render: (a) => html`<${PersonLinks} people=${a.connections} />` },
          { label: 'Buyers', render: (a) => a.buyers.length || '' },
          { label: '', render: (a) => html`<${ActCell} a=${a} />` },
        ]} /></div>
      </section>
    </div>
    <div class="insights-grid">
      <section class="card">
        <div class="head"><div class="grow"><h2>Best accounts not yet touched</h2><div class="small muted">Tier A and B, highest priority, no activity logged</div></div></div>
        <div class="body flush"><${AccountTable} rows=${untouched} empty="Every tier A and B account here has activity." columns=${[
          { label: 'Account', render: (a) => html`<${AccountLink} a=${a} />` },
          { label: 'Tier', render: (a) => html`<${TierChip} tier=${a.tier} />` },
          { label: 'Priority', render: (a) => a.priority ?? '' },
          { label: 'Segment', render: (a) => a.segment ?? '' },
          { label: 'Buyers', render: (a) => a.buyers.length || '—' },
          { label: 'Warm', render: (a) => (a.connections.length ? html`<${Icon} name="link" size=${14} /> ${a.connections.length}` : '') },
          { label: '', render: (a) => html`<${ActCell} a=${a} />` },
        ]} /></div>
      </section>
      <section class="card">
        <div class="head"><div class="grow"><h2>Tier A accounts with no buyer contact</h2><div class="small muted">Research a decision maker before outreach</div></div><span class="muted small">${noBuyer.length}</span></div>
        <div class="body flush"><${AccountTable} rows=${noBuyer} empty="Every tier A account has at least one buyer contact." columns=${[
          { label: 'Account', render: (a) => html`<${AccountLink} a=${a} />` },
          { label: 'Fit', render: (a) => a.fit ?? '' },
          { label: 'Segment', render: (a) => a.segment ?? '' },
          { label: 'Area', render: (a) => a.area },
          { label: '', render: (a) => html`<${ActCell} a=${a} findBuyer />` },
        ]} /></div>
      </section>
    </div>
  </div>`;
}

// ---- Pipeline ---------------------------------------------------------------------

function Pipeline({ data, filters, set }) {
  const scoped = data.accounts.filter((a) => (!filters.tier || tierOf(a) === filters.tier) && (!filters.segment || a.segment === filters.segment));
  const pipeline = scoped.filter((a) => a.stage);
  const active = pipeline.filter((a) => ACTIVE.includes(a.stage));
  const noNext = active.filter((a) => !a.open_tasks);
  const overdue = scoped.reduce((n, a) => n + a.overdue_tasks, 0);
  const series = usedTiers(pipeline);
  const stageRows = tierRows(pipeline, (a) => a.stage, STAGES.map((s) => s.value)).map((r) => ({ ...r, title: stageLabel(r.key), label: html`<${StageBadge} stage=${r.key} />` }));
  const w = data.windows;
  const delta = w.last30.touches - w.prev30.touches;
  const weekCols = data.weekly.map((wk) => ({ key: wk.week, label: fmtDate(wk.week), values: wk.counts }));
  const anyActivity = data.weekly.some((wk) => Object.values(wk.counts).some(Boolean));
  const stale = active.filter((a) => a.days_in_stage != null).sort((a, b) => b.days_in_stage - a.days_in_stage).slice(0, 15);
  const reasons = Object.entries(pipeline.filter((a) => a.close_reason && ['lost', 'disqualified'].includes(a.stage))
    .reduce((m, a) => ((m[a.close_reason] = (m[a.close_reason] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);

  return html`<div>
    <div class="insights-filters">
      <${Select} label="Tier" value=${filters.tier} onChange=${(v) => set({ tier: v })} options=${[['', 'All tiers'], ...TIERS.map((t) => [t.key, t.label])]} />
      <${Select} label="Segment" value=${filters.segment} onChange=${(v) => set({ segment: v })} options=${[['', 'All segments'], ...SEGMENTS.map((s) => [s, s])]} />
    </div>
    <div class="kpis">
      <${StatTile} label="Active pipeline" value=${fmtCount(active.length)} sub=${`${fmtCount(pipeline.length - active.length)} won, lost, nurture or disqualified`} href="#/pipeline" />
      <${StatTile} label="Active accounts with no next action" value=${fmtCount(noNext.length)} status=${noNext.length ? 'serious' : 'good'} sub=${active.length ? `${pct(noNext.length, active.length)} of active pipeline` : ''} />
      <${StatTile} label="Overdue tasks" value=${fmtCount(overdue)} status=${overdue ? 'critical' : 'good'} href="#/tasks" />
      <${StatTile} label="Touches, last 30 days" value=${fmtCount(w.last30.touches)} sub=${`${delta >= 0 ? '+' : '−'}${fmtCount(Math.abs(delta))} vs prior 30 days · all accounts`} />
    </div>
    <div class="insights-grid">
      <${ChartCard} title="Accounts by stage" subtitle="Split by priority tier"
        table=${tierTable(stageRows, series, 'Stage')} empty=${!pipeline.length && 'No accounts in the pipeline for these filters.'}>
        <${BarRows} rows=${stageRows} series=${series} onPick=${(r) => navigate(`/companies?stage=${r.key}${filters.tier && filters.tier !== 'none' ? `&tier=${filters.tier}` : ''}`)} />
      <//>
      <${ChartCard} title="Touches per week" subtitle="Logged activity by type, last 12 weeks · all accounts"
        table=${{ columns: ['Week of', ...ACTIVITY_TYPES, 'Total'], rows: data.weekly.map((wk) => [fmtDate(wk.week), ...ACTIVITY_TYPES.map((t) => wk.counts[t]), Object.values(wk.counts).reduce((a, b) => a + b, 0)]) }}
        empty=${!anyActivity && 'No activity logged in the last 12 weeks. Log outreach, calls and meetings from an account page and they appear here.'}>
        <${Columns} columns=${weekCols} series=${ACTIVITY_SERIES} />
      <//>
    </div>
    <div class="kpis">
      <${StatTile} label="Reply rate, last 90 days" value=${pct(w.last90.replies, w.last90.outreach)} sub=${`${fmtCount(w.last90.replies)} replies to ${fmtCount(w.last90.outreach)} outreach`} />
      <${StatTile} label="Demos held, last 90 days" value=${fmtCount(w.last90.demos)} sub=${`${fmtCount(w.last90.booked)} booked · ${fmtCount(w.last90.visits)} in-person visits`} />
      <${StatTile} label="Moved forward, last 30 days" value=${fmtCount(data.moves.forward30)} sub=${`${fmtCount(data.moves.back30)} moved back · ${fmtCount(data.moves.closed30)} closed`} />
      <${StatTile} label="Open tasks" value=${fmtCount(data.tasks.open)} sub="All accounts and people" href="#/tasks" />
    </div>
    <div class="insights-grid one">
      <section class="card">
        <div class="head"><div class="grow"><h2>Longest in current stage</h2><div class="small muted">Active pipeline accounts</div></div></div>
        <div class="body flush"><${AccountTable} rows=${stale} empty="No active pipeline accounts." columns=${[
          { label: 'Account', render: (a) => html`<${AccountLink} a=${a} />` },
          { label: 'Stage', render: (a) => html`<${StageBadge} stage=${a.stage} />` },
          { label: 'Days', render: (a) => a.days_in_stage },
          { label: 'Tier', render: (a) => html`<${TierChip} tier=${a.tier} />` },
          { label: 'Last touch', render: (a) => (a.last_touch ? fmtAgo(a.last_touch) : html`<span class="faint">Never</span>`) },
          { label: 'Next action', render: (a) => (a.next_due ? fmtDate(a.next_due) : a.open_tasks ? 'No date' : html`<span class="due overdue">None</span>`) },
        ]} /></div>
      </section>
    </div>
    <div class="insights-grid">
      <div class="stack">
        <${ChartCard} title="Stage moves, last 90 days" empty=${!data.moves.recent.length && 'No stage changes in the last 90 days.'}>
          <${DataTable} columns=${['Move', 'Accounts']} rows=${data.moves.recent.map((m) => [`${m.from} → ${m.to}`, m.n])} />
        <//>
        ${reasons.length > 0 && html`<${ChartCard} title="Loss and disqualification reasons">
          <${DataTable} columns=${['Reason', 'Accounts']} rows=${reasons} />
        <//>`}
      </div>
    </div>
  </div>`;
}

// ---- Field visits --------------------------------------------------------------------

const cityKey = (city) => {
  const first = (city ?? '').split(/[/,(]/)[0].trim();
  return first.replace(/\s+metro$/i, ' (metro-wide)') || 'Unspecified';
};
const TIER_SETS = { A: ['A'], AB: ['A', 'B'], all: ['A', 'B', 'C', 'Handoff', 'none'] };

// ---- Greater Phoenix map ------------------------------------------------------------

let geoCache = null;
function useGeo(url) {
  const [geo, setGeo] = useState(geoCache);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (geoCache) return;
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Map data failed to load (${r.status})`))))
      .then((g) => { geoCache = g; setGeo(g); }, setError);
  }, [url]);
  return { geo, error };
}

// City text that names the whole region rather than a city cannot be placed.
const METRO_WIDE = /^\s*(phoenix metro|phoenix valley|greater phoenix|west valley|east valley|arizona|statewide|national|multi)/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Finds the Census place named earliest in the city text ("Scottsdale HQ" -> Scottsdale);
// on a tie the longer name wins ("Sun City West" over "Sun City").
function placeFinder(places) {
  const index = places.map((p) => ({ ...p, re: new RegExp(`\\b${escapeRe(p.name.toLowerCase())}\\b`) }));
  return (city) => {
    const text = (city ?? '').toLowerCase();
    if (!text || METRO_WIDE.test(text)) return null;
    let best = null;
    for (const p of index) {
      const at = text.search(p.re);
      if (at >= 0 && (!best || at < best.at || (at === best.at && p.name.length > best.place.name.length))) best = { at, place: p };
    }
    return best?.place ?? null;
  };
}

const PIN_SERIES = [
  { key: 'A', label: 'Tier A (exact)', color: 'var(--tier-1)' },
  { key: 'B', label: 'Tier B (exact)', color: 'var(--tier-2)' },
  { key: 'other', label: 'Other (exact)', color: 'var(--tier-3)' },
];

function PhoenixMap({ data, pool, onLog }) {
  const { geo, error } = useGeo('./geo/greater-phoenix.json');
  const [selected, setSelected] = useState(null);
  const [showUnplaced, setShowUnplaced] = useState(false);
  const model = useMemo(() => {
    if (!geo) return null;
    const find = placeFinder(geo.places);
    const [w, s, e, n] = geo.bounds;
    const inBounds = (a) => a.lat != null && a.lng != null && a.lng >= w && a.lng <= e && a.lat >= s && a.lat <= n;
    const scoped = pool.filter((a) => a.area === 'Phoenix metro' || a.area === 'Pinal County' || inBounds(a))
      .map((a) => ({ ...a, score: visitScore(a, data.today), place: find(a.city) }));
    const pins = scoped.filter(inBounds);
    const cities = new Map();
    for (const a of scoped) {
      if (inBounds(a) || !a.place) continue;
      if (!cities.has(a.place.name)) cities.set(a.place.name, { key: a.place.name, name: a.place.name, lon: a.place.lon, lat: a.place.lat, accounts: [] });
      cities.get(a.place.name).accounts.push(a);
    }
    const since90 = new Date(Date.parse(`${data.today}T00:00:00Z`) - 89 * 864e5).toISOString().slice(0, 10);
    const bubbles = [...cities.values()].map((c) => {
      const count = (fn) => c.accounts.filter(fn).length;
      const score = Math.round(c.accounts.reduce((sum, a) => sum + a.score, 0) * 10) / 10;
      const stats = {
        accounts: c.accounts.length, a: count((a) => a.tier === 'A'), b: count((a) => a.tier === 'B'),
        warm: count((a) => a.connections.length), buyers: count((a) => a.buyers.length),
        visited: count((a) => a.last_visit && a.last_visit.slice(0, 10) >= since90),
      };
      return {
        ...c, score, stats,
        accounts: c.accounts.sort((x, y) => y.score - x.score || (y.fit ?? -1) - (x.fit ?? -1)),
        tip: [
          { label: 'visit priority', value: fmtCount(score) },
          { label: 'accounts', value: fmtCount(stats.accounts) },
          { label: 'tier A · tier B', value: `${stats.a} · ${stats.b}` },
          { label: 'warm intro paths', value: fmtCount(stats.warm) },
          { label: 'with a buyer contact', value: fmtCount(stats.buyers) },
          { label: 'visited, last 90 days', value: fmtCount(stats.visited) },
        ],
      };
    }).sort((x, y) => y.score - x.score);
    const unplaced = scoped.filter((a) => !inBounds(a) && !a.place).sort((x, y) => y.score - x.score);
    return {
      bubbles, unplaced,
      pins: pins.map((a) => ({
        id: a.id, name: a.name, lon: a.lng, lat: a.lat, series: a.tier === 'A' || a.tier === 'B' ? a.tier : 'other',
        tip: [{ label: 'visit priority', value: fmtCount(a.score) }, { label: 'fit', value: a.fit ?? '—' }, { label: 'buyers', value: fmtCount(a.buyers.length) }],
      })),
    };
  }, [geo, pool, data.today]);

  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!model) return html`<section class="card"><div class="loading">Loading map…</div></section>`;
  const city = model.bubbles.find((b) => b.key === selected) ?? model.bubbles[0];
  const sideAccounts = showUnplaced ? model.unplaced : city?.accounts ?? [];
  const w = VISIT_PRIORITY.tierWeights;
  return html`<section class="card viz-card" style="margin-bottom:16px">
    <div class="head">
      <div class="grow"><h2>Greater Phoenix visit map</h2>
        <div class="small muted">Bubble size is visit priority. Click a bubble for its accounts; pinch, scroll or use the buttons to zoom.</div></div>
    </div>
    <div class="map-layout">
      <div>
        <${GeoBubbleMap} mapName="greater-phoenix" geo=${geo} bubbles=${model.bubbles} pins=${model.pins} pinSeries=${PIN_SERIES}
          selected=${showUnplaced ? null : city?.key} onSelect=${(key) => { setShowUnplaced(false); setSelected(key); }}
          onPin=${(id) => navigate(`/companies/${id}`)} home=${{ center: [-111.93, 33.43], zoom: 2.6 }} />
        <div class="map-caption">
          Priority per account: tier A ${w.A}, B ${w.B}, C ${w.C}; ×${VISIT_PRIORITY.warmMultiplier} with a warm intro path; +${VISIT_PRIORITY.buyerBonus} with a buyer contact;
          ×${VISIT_PRIORITY.recentFactor} if visited in the last ${VISIT_PRIORITY.recentDays} days. Bubbles sit at Census city centers; an account with latitude and longitude gets an exact pin.
          ${model.unplaced.length > 0 && html` <a href="#" onClick=${(e) => { e.preventDefault(); setShowUnplaced(true); }}>${fmtCount(model.unplaced.length)} accounts have no specific city</a>.`}
          <span class="faint"> Boundaries and roads: U.S. Census Bureau TIGER.</span>
        </div>
      </div>
      <aside class="map-side">
        <div class="side-head">
          ${showUnplaced
            ? html`<h2>No specific city</h2><div class="small muted">City text such as "Phoenix metro" or "West Valley"; add an address or coordinates to place these.</div>`
            : city && html`<h2>${city.name}</h2>
              <div class="small muted">Priority ${fmtCount(city.score)} · ${fmtCount(city.stats.accounts)} accounts · A ${city.stats.a} · B ${city.stats.b} · ${city.stats.warm} warm · ${city.stats.visited} visited (90d)</div>`}
        </div>
        <div class="side-list">
          ${!sideAccounts.length ? html`<div class="empty">No accounts for these filters.</div>` : html`<ul class="items">
            ${sideAccounts.map((a) => html`<li key=${a.id}>
              <${TierChip} tier=${a.tier} />
              <div class="grow">
                <a class="title" href=${`#/companies/${a.id}`}>${a.name}</a>
                <div class="meta">${[a.segment, a.fit != null ? `Fit ${a.fit}` : '', `${a.buyers.length} buyer${a.buyers.length === 1 ? '' : 's'}`, a.connections.length ? `${a.connections.length} warm` : '', a.last_visit ? `visited ${fmtDate(a.last_visit)}` : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <span class="due" title="Visit priority">${fmtCount(a.score)}</span>
              <button class="btn small" onClick=${() => onLog(a)}>Log visit</button>
            </li>`)}
          </ul>`}
        </div>
      </aside>
    </div>
  </section>`;
}

function LogVisit({ account, onClose, onSaved }) {
  const people = [...account.buyers, ...account.connections];
  const [v, setV] = useState({ person_id: '', summary: 'In-person visit', body: '', next_action: '', next_due: '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/activities', { ...v, person_id: v.person_id || null, company_id: account.id, type: 'Meeting', channel: 'In person', at: localDay() });
      toast(`Visit to ${account.name} logged`);
      onSaved();
    } catch (error) {
      toast(error, 'error');
      setSaving(false);
    }
  };
  return html`<${Modal} title=${`Log visit: ${account.name}`} onClose=${onClose} footer=${html`
    <button class="btn" onClick=${onClose}>Cancel</button>
    <button class="btn primary" disabled=${saving} onClick=${save}>${saving ? 'Saving…' : 'Save visit'}</button>`}>
    <form class="form-grid" onSubmit=${save}>
      <label class="field full"><span>Met with</span><select class="input" value=${v.person_id} onChange=${set('person_id')}>
        <option value="">—</option>${people.map((p) => html`<option value=${p.id}>${p.name}${p.title ? ` · ${p.title}` : ''}</option>`)}
      </select></label>
      <label class="field full"><span>Summary / outcome</span><input class="input" value=${v.summary} onInput=${set('summary')} /></label>
      <label class="field full"><span>Notes</span><textarea class="input" rows="3" value=${v.body} onInput=${set('body')} /></label>
      <label class="field"><span>Next action</span><input class="input" placeholder="Creates a task" value=${v.next_action} onInput=${set('next_action')} /></label>
      <label class="field"><span>Due</span><input class="input" type="date" value=${v.next_due} onInput=${set('next_due')} /></label>
      <button type="submit" hidden />
    </form>
  <//>`;
}

function Visits({ data, filters, set, reload }) {
  const [logging, setLogging] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const tiers = TIER_SETS[filters.tiers] ?? TIER_SETS.AB;
  const pool = data.accounts.filter((a) => tiers.includes(tierOf(a)) && (!filters.segment || a.segment === filters.segment) && a.stage !== 'disqualified' && a.stage !== 'lost');
  const series = usedTiers(pool);
  const areaRows = tierRows(pool, (a) => a.area, AREAS.filter((n) => pool.some((a) => a.area === n)));
  const inArea = pool.filter((a) => a.area === filters.area);
  const cityRows = tierRows(inArea, (a) => cityKey(a.city)).sort((a, b) => Object.values(b.values).reduce((x, y) => x + y, 0) - Object.values(a.values).reduce((x, y) => x + y, 0)).slice(0, 12);
  const since90 = new Date(Date.parse(`${data.today}T00:00:00Z`) - 89 * 864e5).toISOString().slice(0, 10);
  const plan = inArea.slice().sort((a, b) => TIER_ORDER[tierOf(a)] - TIER_ORDER[tierOf(b)] || (b.connections.length > 0) - (a.connections.length > 0) || (b.fit ?? -1) - (a.fit ?? -1));
  const shown = showAll ? plan : plan.slice(0, 30);

  return html`<div>
    <div class="insights-filters no-print">
      <${Select} label="Area" value=${filters.area} onChange=${(v) => set({ area: v })} options=${AREAS.map((a) => [a, a])} />
      <${Select} label="Tiers" value=${filters.tiers} onChange=${(v) => set({ tiers: v })} options=${[['A', 'Tier A'], ['AB', 'Tiers A and B'], ['all', 'All tiers']]} />
      <${Select} label="Segment" value=${filters.segment} onChange=${(v) => set({ segment: v })} options=${[['', 'All segments'], ...SEGMENTS.map((s) => [s, s])]} />
      <span class="spacer" />
      <button class="btn" onClick=${() => { setShowAll(true); setTimeout(() => print(), 50); }}><${Icon} name="download" size=${16} /> Print visit plan</button>
    </div>
    <div class="no-print"><${PhoenixMap} data=${data} pool=${pool} onLog=${setLogging} /></div>
    <div class="kpis five no-print">
      <${StatTile} label=${`Accounts in ${filters.area}`} value=${fmtCount(inArea.length)} />
      <${StatTile} label="Tier A" value=${fmtCount(inArea.filter((a) => a.tier === 'A').length)} />
      <${StatTile} label="With a buyer contact" value=${fmtCount(inArea.filter((a) => a.buyers.length).length)} />
      <${StatTile} label="Warm intro paths" value=${fmtCount(inArea.filter((a) => a.connections.length).length)} />
      <${StatTile} label="Visited, last 90 days" value=${fmtCount(inArea.filter((a) => a.last_visit && a.last_visit.slice(0, 10) >= since90).length)} />
    </div>
    <div class="insights-grid no-print">
      <${ChartCard} title="Where your targets are" subtitle="Click an area to plan it"
        table=${tierTable(areaRows, series, 'Area')} empty=${!pool.length && 'No accounts match these filters.'}>
        <${BarRows} rows=${areaRows} series=${series} selected=${filters.area} onPick=${(r) => set({ area: r.key })} />
      <//>
      <${ChartCard} title=${`Cities in ${filters.area}`} subtitle="Top 12 by account count"
        table=${tierTable(cityRows, series, 'City')} empty=${!inArea.length && 'No accounts in this area for these filters.'}>
        <${BarRows} rows=${cityRows} series=${series} />
      <//>
    </div>
    <div class="page-head" style="margin:8px 0 12px">
      <div class="grow"><h2 style="font-size:18px">Visit plan: ${filters.area}</h2>
        <div class="sub muted small">${fmtCount(plan.length)} accounts · tier first, then warm intro paths, then fit score · printed ${fmtDate(data.today, { year: true })}</div></div>
    </div>
    ${!plan.length ? html`<div class="card"><div class="empty">No accounts to visit in this area for these filters.</div></div>` : html`<div class="visit-list">
      ${shown.map((a) => html`<article class="card visit" key=${a.id}>
        <div class="top">
          <${TierChip} tier=${a.tier} />
          <div class="grow"><a class="name" href=${`#/companies/${a.id}`}>${a.name}</a>
            <div class="small muted">${[a.segment, cityKey(a.city), a.fit != null ? `Fit ${a.fit}` : '', a.product_fit].filter(Boolean).join(' · ')}</div></div>
          ${a.stage && html`<${StageBadge} stage=${a.stage} />`}
        </div>
        <dl>
          <dt>Buyers</dt><dd>${a.buyers.length ? a.buyers.slice(0, 3).map((b, i) => html`${i ? html`<br />` : ''}<a href=${`#/people/${b.id}`}>${b.name}</a>${b.title ? html`<span class="muted"> · ${b.title}</span>` : ''}`) : html`<span class="faint">None yet</span>`}${a.buyers.length > 3 ? html`<br /><span class="muted">+${a.buyers.length - 3} more</span>` : ''}</dd>
          <dt>Warm path</dt><dd>${a.connections.length ? html`<${PersonLinks} people=${a.connections} />` : html`<span class="faint">None</span>`}</dd>
          <dt>Last touch</dt><dd>${a.last_touch ? fmtAgo(a.last_touch) : html`<span class="faint">Never</span>`}</dd>
          <dt>Last visit</dt><dd>${a.last_visit ? fmtDate(a.last_visit) : html`<span class="faint">Never</span>`}</dd>
          <dt>Next action</dt><dd>${a.next_due ? fmtDate(a.next_due) : a.open_tasks ? 'Open, no date' : html`<span class="faint">None</span>`}</dd>
        </dl>
        <div class="row no-print"><span class="spacer" /><button class="btn small primary" onClick=${() => setLogging(a)}>Log visit</button></div>
      </article>`)}
    </div>
    ${plan.length > shown.length && html`<div class="row no-print" style="justify-content:center;margin-top:12px"><button class="btn" onClick=${() => setShowAll(true)}>Show all ${fmtCount(plan.length)}</button></div>`}`}
    ${logging && html`<${LogVisit} account=${logging} onClose=${() => setLogging(null)} onSaved=${() => { setLogging(null); reload(); }} />`}
  </div>`;
}

// ---- Page ------------------------------------------------------------------------------

const TABS = [['prospecting', 'Prospecting'], ['pipeline', 'Pipeline'], ['visits', 'Field visits']];

export function Insights({ query }) {
  const { data, error, loading, reload } = useApi(`/api/analytics?today=${localDay()}&tz=${new Date().getTimezoneOffset()}`);
  useChanged(reload);
  const [tab, setTab] = useState(TABS.some(([k]) => k === query.tab) ? query.tab : 'prospecting');
  const [filters, setFilters] = useState({ source: query.source ?? '', segment: query.segment ?? '', region: query.region ?? '', area: query.area ?? '', tier: query.tier ?? '', tiers: query.tiers ?? 'AB' });
  // The visits tab always has an area: default to the one with the most tier A targets.
  const defaultArea = useMemo(() => {
    if (!data) return '';
    const counts = {};
    for (const a of data.accounts) if (a.tier === 'A' && VISIT_AREAS.some((v) => v.name === a.area)) counts[a.area] = (counts[a.area] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? VISIT_AREAS[0].name;
  }, [data]);
  useEffect(() => {
    history.replaceState(null, '', `#/insights?tab=${tab}${Object.entries(filters).filter(([k, v]) => v && !(k === 'tiers' && v === 'AB')).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')}`);
  }, [tab, filters]);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const visitFilters = { ...filters, area: filters.area && AREAS.includes(filters.area) ? filters.area : defaultArea };
  return html`<div style=${loading ? 'opacity:.6;transition:opacity .2s' : ''}>
    <div class="page-head no-print">
      <div class="grow"><h1>Insights</h1><div class="sub muted">Prospecting focus, pipeline health and in-person visit planning</div></div>
      <div class="tabs insights-tabs" role="tablist">
        ${TABS.map(([key, label]) => html`<button role="tab" aria-selected=${tab === key} class=${tab === key ? 'on' : ''} onClick=${() => setTab(key)}>${label}</button>`)}
      </div>
    </div>
    ${tab === 'prospecting' && html`<${Prospecting} data=${data} filters=${filters} set=${set} />`}
    ${tab === 'pipeline' && html`<${Pipeline} data=${data} filters=${filters} set=${set} />`}
    ${tab === 'visits' && html`<${Visits} data=${data} filters=${visitFilters} set=${set} reload=${reload} />`}
  </div>`;
}
