import { html, useState, useEffect, useRef, useCallback } from '../vendor/preact-htm.js';
import { api } from './api.js';
import { STAGES, stageLabel, stageColor } from '../schema.js';

export { html, useState, useEffect, useRef, useCallback };

// ---- Navigation -------------------------------------------------------------

export const navigate = (hash) => { location.hash = hash; };

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(query)) };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

// ---- Data loading -------------------------------------------------------------

// Loads `path` and reloads when it changes or when `reload()` is called.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api.get(path).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState({ data: null, error, loading: false }),
    );
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

// Broadcast so open views refresh after edits made elsewhere (e.g. quick add).
export const changed = () => dispatchEvent(new Event('crm:changed'));
export function useChanged(fn) {
  useEffect(() => {
    addEventListener('crm:changed', fn);
    return () => removeEventListener('crm:changed', fn);
  }, [fn]);
}

// ---- Toasts -----------------------------------------------------------------

let pushToast = () => {};
export const toast = (message, kind = 'info') => pushToast({ message: String(message?.message ?? message), kind, id: Math.random() });

export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushToast = (item) => {
      setItems((list) => [...list, item]);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== item.id)), item.kind === 'error' ? 6000 : 2600);
    };
  }, []);
  return html`<div class="toasts" role="status">${items.map((t) => html`<div class=${`toast ${t.kind}`} key=${t.id}>${t.message}</div>`)}</div>`;
}

// ---- Formatting -------------------------------------------------------------

export function localDay(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDate(value, { year } = {}) {
  if (!value) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const showYear = year ?? d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(showYear ? { year: 'numeric' } : {}) });
}

export function fmtAgo(value) {
  if (!value) return '';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 864e5);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return fmtDate(value);
}

export function dueClass(due) {
  if (!due) return 'due';
  const today = localDay();
  return due < today ? 'due overdue' : due === today ? 'due today' : 'due';
}

export const fmtCount = (n) => Number(n ?? 0).toLocaleString();
export const initials = (text) => (text || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// ---- Icons (24px stroke icons) ---------------------------------------------

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  check: 'M20 6 9 17l-5-5',
  checkSquare: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  x: 'M18 6 6 18M6 6l12 12',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  note: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  back: 'M19 12H5M12 19l-7-7 7-7',
  chart: 'M3 3v18h18M7 14l4-4 3 3 6-6',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
};

export function Icon({ name, size = 18 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${PATHS[name]} /></svg>`;
}

export const ACTIVITY_ICONS = { Outreach: 'arrowRight', Reply: 'message', Meeting: 'calendar', 'Demo booked': 'calendar', 'Demo held': 'checkSquare', Call: 'phone', 'Intro request': 'link', Note: 'note', 'Stage change': 'board' };

// ---- Small components -------------------------------------------------------

export function StageBadge({ stage }) {
  if (!stage) return html`<span class="faint small">Not in pipeline</span>`;
  return html`<span class="badge" style=${`--c:${stageColor(stage)}`}>${stageLabel(stage)}</span>`;
}

export const TierChip = ({ tier }) => tier && html`<span class=${`tier-chip t-${tier}`} title=${`Tier ${tier}`}>${tier === 'Handoff' ? 'H' : tier}</span>`;

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label=${title} style=${wide ? 'max-width:760px' : ''}>
      <header><h2 class="grow">${title}</h2><button class="btn ghost icon" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button></header>
      <div class="body">${children}</div>
      ${footer && html`<footer>${footer}</footer>`}
    </div>
  </div>`;
}

export function Loading() {
  return html`<div class="loading">Loading…</div>`;
}

export function ErrorBox({ error, onRetry }) {
  return html`<div class="card"><div class="body row"><span class="grow" style="color:var(--danger)">${error.message}</span>${onRetry && html`<button class="btn" onClick=${onRetry}>Retry</button>`}</div></div>`;
}

export function TaskItem({ task, onChange, showLink = true }) {
  const toggle = async () => {
    try {
      await api.patch(`/api/tasks/${task.id}`, { done: !task.done_at });
      onChange?.();
      changed();
    } catch (error) { toast(error, 'error'); }
  };
  const remove = async () => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    try { await api.del(`/api/tasks/${task.id}`); onChange?.(); changed(); } catch (error) { toast(error, 'error'); }
  };
  const person = [task.first_name, task.last_name].filter(Boolean).join(' ');
  return html`<li class=${task.done_at ? 'done' : ''}>
    <button class=${`check ${task.done_at ? 'on' : ''}`} onClick=${toggle} aria-label=${task.done_at ? 'Mark not done' : 'Mark done'}>${task.done_at && html`<${Icon} name="check" size=${14} />`}</button>
    <div class="grow">
      <div class="title">${task.title}</div>
      ${showLink && (task.company_name || person) && html`<div class="meta">
        ${task.company_id && html`<a href=${`#/companies/${task.company_id}`}>${task.company_name}</a>`}
        ${task.company_id && task.person_id && ' · '}
        ${task.person_id && html`<a href=${`#/people/${task.person_id}`}>${person}</a>`}
      </div>`}
    </div>
    ${task.due_date && html`<span class=${task.done_at ? 'due' : dueClass(task.due_date)}>${fmtDate(task.due_date)}</span>`}
    <button class="btn ghost small icon" onClick=${remove} aria-label="Delete task"><${Icon} name="trash" size=${15} /></button>
  </li>`;
}

// ---- Field editors ------------------------------------------------------------

// Inline editor that saves on blur (text) or on change (select/date).
export function FieldEditor({ field, value, onSave }) {
  const [draft, setDraft] = useState(value ?? '');
  const [status, setStatus] = useState('');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = async (next) => {
    if ((next ?? '') === (value ?? '')) return;
    try {
      await onSave(next);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 1500);
    } catch (error) {
      setDraft(value ?? '');
      toast(error, 'error');
    }
  };
  const id = `f-${field.key}`;
  let input;
  if (field.type === 'select') {
    const options = field.key === 'stage' ? STAGES.map((s) => [s.value, s.label]) : field.options.map((o) => [o, o]);
    input = html`<select id=${id} class="input" value=${draft} onChange=${(e) => { setDraft(e.target.value); commit(e.target.value); }}>
      <option value="">${field.key === 'stage' ? 'Not in pipeline' : '—'}</option>
      ${options.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
    </select>`;
  } else if (field.type === 'longtext') {
    input = html`<textarea id=${id} class="input" rows="3" value=${draft} onInput=${(e) => setDraft(e.target.value)} onBlur=${() => commit(draft)} />`;
  } else {
    const type = { date: 'date', email: 'email', phone: 'tel', url: 'url', number: 'number' }[field.type] ?? 'text';
    input = html`<input id=${id} class="input" type=${type === 'url' ? 'text' : type} inputmode=${type === 'url' ? 'url' : undefined} value=${draft}
      onInput=${(e) => setDraft(e.target.value)} onBlur=${() => commit(draft)} onChange=${field.type === 'date' ? (e) => commit(e.target.value) : undefined}
      onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />`;
  }
  const href = !value ? null : field.type === 'url' ? value : field.type === 'email' ? `mailto:${value}` : field.type === 'phone' ? `tel:${value}` : null;
  const icon = { url: 'external', email: 'mail', phone: 'phone' }[field.type];
  return html`<div class=${`field-row ${field.type === 'longtext' ? 'top' : ''}`}>
    <label class="label" for=${id}>${field.label} ${status && html`<span class="saved">✓</span>`}</label>
    <div class="with-action">
      ${input}
      ${href && html`<a class="btn icon" href=${href} target="_blank" rel="noopener noreferrer" aria-label=${`Open ${field.label}`}><${Icon} name=${icon} size=${16} /></a>`}
    </div>
  </div>`;
}

// Company search box. Calls onPick({ id, name }), or onPick({ name }) for a new company
// unless `allowCreate` is off.
export function CompanyPicker({ value, onPick, placeholder = 'Search or add company', autoFocus, allowCreate = true }) {
  const [text, setText] = useState(value ?? '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => setText(value ?? ''), [value]);
  useEffect(() => {
    if (!open || !text.trim()) { setResults([]); return; }
    const timer = setTimeout(() => api.get(`/api/companies?limit=8&q=${encodeURIComponent(text)}`).then((r) => setResults(r.rows), () => {}), 180);
    return () => clearTimeout(timer);
  }, [text, open]);
  const exact = results.some((r) => r.name.toLowerCase() === text.trim().toLowerCase());
  const pick = (item) => { setOpen(false); setText(item.name); onPick(item); };
  return html`<div class="picker">
    <input class="input" value=${text} placeholder=${placeholder} autofocus=${autoFocus}
      onInput=${(e) => { setText(e.target.value); setOpen(true); }}
      onFocus=${() => setOpen(true)}
      onBlur=${() => setTimeout(() => setOpen(false), 150)}
      onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); if (results[0] && (exact || !allowCreate)) pick(results[0]); else if (text.trim() && allowCreate) pick({ name: text.trim() }); } }} />
    ${open && text.trim() && (results.length > 0 || allowCreate) && html`<div class="search-results">
      ${results.map((r) => html`<a href="#" onMouseDown=${(e) => { e.preventDefault(); pick(r); }}><span class="grow ellipsis">${r.name}</span>${r.stage && html`<${StageBadge} stage=${r.stage} />`}</a>`)}
      ${!exact && allowCreate && html`<a href="#" onMouseDown=${(e) => { e.preventDefault(); pick({ name: text.trim() }); }}><${Icon} name="plus" size=${15} /> Create “${text.trim()}”</a>`}
    </div>`}
  </div>`;
}
