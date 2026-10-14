import { html, useState, useEffect, useChanged, ErrorBox, Loading, Icon, StageBadge, TierChip, navigate, fmtAgo, fmtCount, toast, changed } from '../lib/ui.js';
import { api, qs } from '../lib/api.js';
import { ENTITIES, STAGES, personName } from '../schema.js';
import { openNew } from './quickadd.js';

const PAGE = 100;

// Each list opens on the view that matters most for prospecting.
const VIEWS = {
  companies: [
    { key: 'targets', label: 'Targets', sort: 'priority', dir: 'desc', empty: 'No scored target accounts yet. Import a target list from Settings.' },
    { key: 'pipeline', label: 'In pipeline', sort: 'fit_score', dir: 'desc', empty: 'Nothing in the pipeline yet. Add accounts from Targets.' },
    { key: 'all', label: 'All companies', sort: 'name', dir: 'asc', empty: 'No companies match.' },
  ],
  people: [
    { key: 'purchased', label: 'Purchased leads', sort: 'lead_score', dir: 'desc', empty: 'No purchased leads match.' },
    { key: 'buyers', label: 'Buyers', sort: 'company_fit', dir: 'desc', empty: 'No buyer contacts yet. Mark people as Buyer, or import a contact list.' },
    { key: 'connections', label: 'Your connections', sort: 'name', dir: 'asc', empty: 'No connections imported.' },
    { key: 'all', label: 'Everyone', sort: 'name', dir: 'asc', empty: 'No people match.' },
  ],
};

const stop = (e) => e.stopPropagation();

function companyColumns(addOne) {
  return [
    { label: 'Account', sort: 'name', render: (r) => html`<span class="row nowrap"><${TierChip} tier=${r.tier} /><span class="ellipsis">${r.name}</span></span>` },
    { label: 'Fit', sort: 'fit_score', render: (r) => (r.fit_score != null ? html`<span class="fit-pill">${r.fit_score}</span>` : '') },
    { label: 'Priority', sort: 'priority', render: (r) => r.priority ?? '—' },
    { label: 'Stage', sort: 'stage', render: (r) => (r.stage ? html`<${StageBadge} stage=${r.stage} />`
      : html`<button class="btn small add-pipeline" onClick=${(e) => { stop(e); addOne(r); }}><${Icon} name="plus" size=${13} /> Pipeline</button>`) },
    { label: 'Segment', sort: 'segment', render: (r) => r.segment ?? '' },
    { label: 'Location', sort: 'state', render: (r) => [r.city?.split(/[/,(]/)[0].trim(), r.state].filter(Boolean).join(', ') },
    { label: 'Buyers', sort: 'buyers_count', render: (r) => r.buyers_count || html`<span class="faint">—</span>` },
    { label: 'Warm', sort: 'warm_count', render: (r) => (r.warm_count ? html`<span class="warm-count" title="Your LinkedIn connections here"><${Icon} name="link" size=${13} /> ${r.warm_count}</span>` : '') },
    { label: 'Last touch', sort: 'last_activity_at', render: (r) => (r.last_activity_at ? fmtAgo(r.last_activity_at) : html`<span class="faint">Never</span>`) },
  ];
}

function peopleColumns(view) {
  return [
    { label: 'Name', sort: 'name', render: (r) => html`<a href=${`#/people/${r.id}`}>${personName(r)}</a><span class="tablet-title">${r.title ?? ''}</span>` },
    { label: 'Title', sort: 'title', render: (r) => r.title ?? '' },
    { label: 'Lead score', sort: 'lead_score', render: (r) => r.lead_score ?? '—' },
    { label: 'Company', sort: 'company_fit', render: (r) => (r.company_name ? html`<span class="row nowrap"><${TierChip} tier=${r.company_tier} /><span class="ellipsis">${r.company_name}</span></span>` : '') },
    ...(view === 'all' ? [{ label: 'Relationship', sort: 'relationship', render: (r) => r.relationship ?? '' }] : []),
    { label: 'Reach', render: (r) => html`<span class="row nowrap reach-icons">
      ${r.email ? html`<a href=${`mailto:${r.email}`} onClick=${stop} title=${r.email} aria-label="Email"><${Icon} name="mail" size=${15} /></a>` : html`<span class="faint" title="No email"><${Icon} name="mail" size=${15} /></span>`}
      ${r.linkedin_url ? html`<a href=${r.linkedin_url} target="_blank" rel="noopener noreferrer" onClick=${stop} aria-label="LinkedIn"><${Icon} name="external" size=${15} /></a>` : ''}
      ${r.phone ? html`<a href=${`tel:${r.phone}`} onClick=${stop} aria-label="Call"><${Icon} name="phone" size=${15} /></a>` : ''}</span>` },
    { label: 'Last touch', sort: 'last_activity_at', render: (r) => (r.last_activity_at ? fmtAgo(r.last_activity_at) : html`<span class="faint">Never</span>`) },
  ];
}

export function RecordList({ kind, query }) {
  const def = ENTITIES[kind];
  const views = VIEWS[kind];
  const initialView = views.find((v) => v.key === query.view) ?? (Object.keys(query).length ? views.find((v) => v.key === 'all') : views[0]);
  const [view, setView] = useState(initialView);
  // Filters the view already implies are hidden (relationship on Buyers, for example).
  const filterFields = def.fields.filter((f) => f.filter && f.type === 'select' && !(kind === 'people' && f.key === 'relationship' && view.key !== 'all'));
  const [text, setText] = useState(query.q ?? '');
  const [search, setSearch] = useState(query.q ?? '');
  const [filters, setFilters] = useState(() => Object.fromEntries(def.fields.filter((f) => f.filter).map((f) => [f.key, query[f.key] ?? ''])));
  const [sort, setSort] = useState({ key: query.sort ?? initialView.sort, dir: query.dir ?? initialView.dir });
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text), 250);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    Promise.all(views.map((v) => api.get(`/api/${kind}?view=${v.key}&limit=1`).then((r) => [v.key, r.total], () => [v.key, null])))
      .then((pairs) => setCounts(Object.fromEntries(pairs)));
  }, [kind]);

  const params = { view: view.key, q: search, ...filters, sort: sort.key, dir: sort.dir };
  const key = JSON.stringify(params);
  const load = (offset = 0) => {
    setBusy(true);
    return api.get(`/api/${kind}${qs({ ...params, limit: PAGE, offset })}`)
      .then((page) => { setData((prev) => (offset && prev ? { ...page, rows: [...prev.rows, ...page.rows] } : page)); setError(null); })
      .catch(setError)
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load(0);
    setSelected(new Set());
    history.replaceState(null, '', `#/${kind}${qs({ view: view.key === views[0].key ? '' : view.key, q: search, ...filters, sort: sort.key === view.sort ? '' : sort.key, dir: sort.dir === view.dir ? '' : sort.dir })}`);
  }, [key]);
  useChanged(() => load(0));

  const switchView = (v) => { setView(v); setSort({ key: v.sort, dir: v.dir }); };
  const addToPipeline = async (ids) => {
    try {
      await api.post('/api/companies/bulk', { ids, patch: { stage: 'research' } });
      toast(`${ids.length === 1 ? '1 account' : `${ids.length} accounts`} added to the pipeline`);
      setSelected(new Set());
      changed();
    } catch (err) { toast(err, 'error'); }
  };
  const columns = kind === 'companies' ? companyColumns((r) => addToPipeline([r.id])) : peopleColumns(view.key);
  const toggleSort = (col) => col.sort && setSort((s) => ({ key: col.sort, dir: s.key === col.sort && s.dir === 'desc' ? 'asc' : 'desc' }));
  const optionsFor = (field) => (field.key === 'stage'
    ? [['', 'Any stage'], ['pipeline', 'In pipeline'], ['none', 'Not in pipeline'], ...STAGES.map((s) => [s.value, s.label])]
    : [['', `Any ${field.label.toLowerCase()}`], ...field.options.map((o) => [o, o])]);
  const selectable = kind === 'companies';
  const rows = data?.rows ?? [];
  const allChecked = selectable && rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const addable = [...selected].filter((id) => !rows.find((r) => r.id === id)?.stage);

  return html`<div class=${`records-page records-${kind}`}>
    <div class="page-head list-head">
      <div class="grow"><h1>${def.label}</h1></div>
      <button class="btn primary" onClick=${() => openNew(kind)}><${Icon} name="plus" size=${16} /> New ${def.singular.toLowerCase()}</button>
    </div>
    <div class="view-tabs" role="tablist">
      ${views.map((v) => html`<button role="tab" aria-selected=${v.key === view.key} class=${v.key === view.key ? 'on' : ''} onClick=${() => switchView(v)}>
        ${v.label}${counts[v.key] != null && html`<span class="count">${fmtCount(counts[v.key])}</span>`}</button>`)}
    </div>
    <div class="mobile-list-controls">
      <label>View<select class="input" aria-label=${`${def.label} view`} value=${view.key} onChange=${(e) => switchView(views.find((v) => v.key === e.target.value))}>
        ${views.map((v) => html`<option value=${v.key}>${v.label}${counts[v.key] != null ? ` (${fmtCount(counts[v.key])})` : ''}</option>`)}
      </select></label>
      <label>Sort by<select class="input" aria-label="Sort records by" value=${`${sort.key}:${sort.dir}`} onChange=${(e) => {const [key,dir]=e.target.value.split(':');setSort({key,dir});}}>
        ${columns.filter((c) => c.sort).map((c) => ['desc','asc'].map((dir) => html`<option value=${`${c.sort}:${dir}`}>${c.label} ${dir === 'desc' ? '↓' : '↑'}</option>`))}
      </select></label>
    </div>
    <div class="toolbar">
      <div class="search"><${Icon} name="search" size=${16} /><input class="input" type="search" placeholder=${`Search ${def.label.toLowerCase()}`} value=${text} onInput=${(e) => setText(e.target.value)} /></div>
      ${filterFields.map((field) => html`<select class=${`input ${filters[field.key] ? 'active' : ''}`} key=${field.key} value=${filters[field.key]} aria-label=${field.label}
        onChange=${(e) => setFilters((f) => ({ ...f, [field.key]: e.target.value }))}>
        ${optionsFor(field).map(([v, l]) => html`<option value=${v}>${l}</option>`)}
      </select>`)}
      <span class="spacer" />
      ${data && html`<span class="muted small">${fmtCount(data.total)} ${data.total === 1 ? def.singular.toLowerCase() : def.label.toLowerCase()}</span>`}
    </div>
    ${error ? html`<${ErrorBox} error=${error} onRetry=${() => load(0)} />` : !data ? html`<${Loading} />` : html`<div class=${`card ${busy ? 'is-loading' : ''}`}>
      <div class="table-wrap records-table"><table class="data">
        <thead><tr>
          ${selectable && html`<th class="check-col"><input type="checkbox" aria-label="Select all on this page" checked=${allChecked}
            onChange=${() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>`}
          ${columns.map((c, i) => html`<th class=${`col-${c.sort ?? 'reach'} ${c.sort ? 'sortable' : ''} ${i > 3 ? 'optional' : ''}`} aria-sort=${sort.key === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>${c.sort ? html`<button class="table-sort" onClick=${() => toggleSort(c)}>${c.label}${sort.key === c.sort && html`<span class="dir">${sort.dir === 'asc' ? '↑' : '↓'}</span>`}</button>` : c.label}</th>`)}
        </tr></thead>
        <tbody>
          ${rows.map((row) => html`<tr key=${row.id} class=${selected.has(row.id) ? 'selected' : ''} onClick=${(e) => !e.target.closest('a,button,input') && navigate(`/${kind}/${row.id}`)}>
            ${selectable && html`<td class="check-col" onClick=${stop}><input type="checkbox" aria-label=${`Select ${row.name}`} checked=${selected.has(row.id)} onChange=${() => toggle(row.id)} /></td>`}
            ${columns.map((c, i) => html`<td class=${`col-${c.sort ?? 'reach'} ${i === 0 ? 'primary' : ''} ${i > 3 ? 'optional' : ''}`}>${i === 0 && kind === 'companies' ? html`<a href=${`#/companies/${row.id}`}>${c.render(row)}</a>` : c.render(row)}</td>`)}
          </tr>`)}
        </tbody>
      </table></div>
      <div class="mobile-records">
        ${rows.map((r) => html`<article class=${`mobile-record ${selected.has(r.id) ? 'selected' : ''}`} key=${r.id}>
          ${selectable && html`<label class="mobile-selection"><input type="checkbox" aria-label=${`Select ${r.name}`} checked=${selected.has(r.id)} onChange=${() => toggle(r.id)} /><span>Select</span></label>`}
          <div class="mobile-record-head">
            <a class="mobile-record-link" href=${`#/${kind}/${r.id}`}><${TierChip} tier=${kind === 'people' ? r.company_tier : r.tier} /><strong>${kind === 'people' ? personName(r) : r.name}</strong></a>
            <span class="mobile-score"><span>${kind === 'people' ? 'Lead score' : 'Priority'}</span><strong>${(kind === 'people' ? r.lead_score : r.priority) ?? '—'}</strong></span>
          </div>
          ${kind === 'people' ? html`<p class="mobile-record-title">${r.title || 'Title not available'}</p>
            ${r.company_name && html`<a class="mobile-company" href=${`#/companies/${r.company_id}`}>${r.company_name}</a>`}
            <div class="mobile-record-actions"><a class="btn small" href=${`#/people/${r.id}`}>View lead</a>
              ${r.email && html`<a class="btn small" href=${`mailto:${r.email}`} aria-label=${`Email ${personName(r)}`}><${Icon} name="mail" size=${16} /> Email</a>`}
              ${r.phone && html`<a class="btn small" href=${`tel:${r.phone}`} aria-label=${`Call ${personName(r)}`}><${Icon} name="phone" size=${16} /> Call</a>`}
              ${r.linkedin_url && html`<a class="btn small" href=${r.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a>`}
            </div>` : html`<p class="mobile-record-title">${[r.segment,r.city,r.state].filter(Boolean).join(' · ')}</p>
            <div class="mobile-record-actions"><${StageBadge} stage=${r.stage} />
              ${!r.stage && html`<button class="btn small" onClick=${() => addToPipeline([r.id])}><${Icon} name="plus" size=${16} /> Add to pipeline</button>`}
              <a class="btn small" href=${`#/companies/${r.id}`}>View account</a>
            </div>`}
        </article>`)}
      </div>
      ${!rows.length && html`<div class="empty">${search || Object.values(filters).some(Boolean) ? `No ${def.label.toLowerCase()} match these filters.` : view.empty}</div>`}
      ${rows.length < data.total && html`<div class="list-foot">
        <span class="muted small">Showing ${fmtCount(rows.length)} of ${fmtCount(data.total)}</span>
        <button class="btn" disabled=${busy} onClick=${() => load(rows.length).catch((e) => toast(e, 'error'))}>Show more</button>
      </div>`}
    </div>`}
    ${selected.size > 0 && html`<div class="bulk-bar" role="region" aria-label="Selection">
      <strong>${selected.size} selected</strong>
      <button class="btn primary" disabled=${!addable.length} onClick=${() => addToPipeline(addable)}><${Icon} name="plus" size=${15} /> Add ${addable.length || ''} to pipeline</button>
      <button class="btn ghost" onClick=${() => setSelected(new Set())}>Clear</button>
    </div>`}
  </div>`;
}
