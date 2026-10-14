import { html, useState, useEffect, useRef, useCallback, useChanged, Loading, ErrorBox, Icon, Modal, TierChip, toast, changed, navigate, fmtDate, fmtAgo, dueClass } from '../lib/ui.js';
import { api } from '../lib/api.js';
import { STAGES } from '../schema.js';

async function loadPipeline() {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await api.get(`/api/companies?stage=pipeline&limit=500&offset=${offset}&sort=tier`);
    rows.push(...page.rows);
    if (rows.length >= page.total || !page.rows.length) return rows;
  }
}

// Drag with pointer events so the same code works for mouse, pen and touch.
function useDrag(onDrop) {
  const state = useRef(null);
  const start = (event, company) => {
    if (event.button > 0) return;
    event.preventDefault();
    const card = event.currentTarget.closest('.deal');
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('drag-ghost');
    document.body.append(ghost);
    card.classList.add('dragging');
    const board = card.closest('.board');
    state.current = { company, card, ghost, dx: event.clientX - rect.left, dy: event.clientY - rect.top, over: null, x: event.clientX };
    // Scroll the board while the pointer rests near its left or right edge.
    const scroller = setInterval(() => {
      const s = state.current;
      if (!s) return;
      const bounds = board.getBoundingClientRect();
      if (s.x > bounds.right - 70) board.scrollLeft += 14;
      else if (s.x < bounds.left + 70) board.scrollLeft -= 14;
    }, 16);
    const move = (e) => {
      const s = state.current;
      s.x = e.clientX;
      s.ghost.style.left = `${e.clientX - s.dx}px`;
      s.ghost.style.top = `${e.clientY - s.dy}px`;
      const column = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-stage]');
      if (s.over !== column) { s.over?.classList.remove('over'); column?.classList.add('over'); s.over = column; }
    };
    const end = () => {
      const s = state.current;
      clearInterval(scroller);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      s.ghost.remove();
      s.card.classList.remove('dragging');
      s.over?.classList.remove('over');
      state.current = null;
      const stage = s.over?.dataset.stage;
      if (stage && stage !== s.company.stage) onDrop(s.company, stage);
    };
    move(event);
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  };
  return start;
}

const TIER_RANK = { A: 0, B: 1, C: 2, Handoff: 3 };
const OPEN = STAGES.filter((s) => !['nurture', 'lost', 'disqualified'].includes(s.value));
const CLOSED = STAGES.filter((s) => ['nurture', 'lost', 'disqualified'].includes(s.value));
const nextStage = (stage) => {
  const i = OPEN.findIndex((s) => s.value === stage);
  return i >= 0 && i < OPEN.length - 1 ? OPEN[i + 1] : null;
};
const byPriority = (a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (Number(b.fit_score) || 0) - (Number(a.fit_score) || 0);

// Picks target accounts that are not in the pipeline yet, best fit first.
function AddAccounts({ onClose, onAdded }) {
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get('/api/companies?view=targets&stage=none&sort=fit_score&dir=desc&limit=40').then((r) => {
      setRows(r.rows);
      setPicked(new Set(r.rows.slice(0, 10).map((c) => c.id)));
    }, (e) => { toast(e, 'error'); setRows([]); });
  }, []);
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const add = async () => {
    setSaving(true);
    try {
      await api.post('/api/companies/bulk', { ids: [...picked], patch: { stage: 'research' } });
      toast(`${picked.size} account${picked.size === 1 ? '' : 's'} added to Research`);
      changed();
      onAdded();
    } catch (e) { toast(e, 'error'); setSaving(false); }
  };
  return html`<${Modal} title="Add accounts to the pipeline" wide onClose=${onClose} footer=${html`
    <span class="small muted grow">${picked.size} selected · they start in Research</span>
    <button class="btn" onClick=${onClose}>Cancel</button>
    <button class="btn primary" disabled=${!picked.size || saving} onClick=${add}>${saving ? 'Adding…' : `Add ${picked.size}`}</button>`}>
    ${!rows ? html`<${Loading} />` : !rows.length ? html`<div class="empty">Every target account is already in the pipeline.</div>` : html`
      <p class="small muted" style="margin:0 0 10px">Target accounts not yet in the pipeline, highest fit first. The top 10 are selected.</p>
      <ul class="items pick-list">${rows.map((c) => html`<li key=${c.id}>
        <label class="row grow">
          <input type="checkbox" checked=${picked.has(c.id)} onChange=${() => toggle(c.id)} />
          <${TierChip} tier=${c.tier} /><span class="grow"><strong>${c.name}</strong><span class="small muted"> · ${[c.segment, c.state].filter(Boolean).join(' · ')}</span></span>
          ${c.warm_count > 0 && html`<span class="warm-count"><${Icon} name="link" size=${13} /> ${c.warm_count} warm</span>`}
          <span class="small muted">${c.buyers_count} buyer${c.buyers_count === 1 ? '' : 's'}</span>
          <span class="fit-pill">${c.fit_score ?? '—'}</span>
        </label>
      </li>`)}</ul>`}
  <//>`;
}

function Card({ c, onMove, startDrag }) {
  const to = nextStage(c.stage);
  const status = c.next_due ? html`<span class=${dueClass(c.next_due)}>Next ${fmtDate(c.next_due)}</span>`
    : c.open_tasks ? html`<span class="due">Task open</span>` : html`<span class="due overdue">No next step</span>`;
  return html`<div class="deal" onClick=${() => navigate(`/companies/${c.id}`)}>
    <span class="grip" onPointerDown=${(e) => { e.stopPropagation(); startDrag(e, c); }} onClick=${(e) => e.stopPropagation()} aria-hidden="true"><${Icon} name="grip" size=${16} /></span>
    <div class="grow">
      <div class="row nowrap deal-title"><${TierChip} tier=${c.tier} /><span class="name">${c.name}</span></div>
      <div class="small muted ellipsis">${[c.segment, c.fit_score != null ? `Fit ${c.fit_score}` : '', c.last_activity_at ? `touched ${fmtAgo(c.last_activity_at)}` : 'not touched'].filter(Boolean).join(' · ')}</div>
      <div class="row small deal-foot">${status}<span class="spacer" />
        ${to && html`<button class="btn small ghost advance" onClick=${(e) => { e.stopPropagation(); onMove(c, to.value); }} title=${`Move to ${to.label}`}>${to.label} →</button>`}
      </div>
    </div>
  </div>`;
}

export function Pipeline() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState({});
  const reload = useCallback(() => loadPipeline().then(setRows, setError), []);
  useEffect(() => { reload(); }, [reload]);
  useChanged(reload);

  const move = async (company, stage) => {
    setRows((list) => list.map((c) => (c.id === company.id ? { ...c, stage, stage_entered_at: new Date().toISOString() } : c)));
    try {
      await api.patch(`/api/companies/${company.id}`, { stage });
      toast(`${company.name} moved to ${STAGES.find((s) => s.value === stage).label}`);
      changed();
    } catch (err) {
      toast(err, 'error');
      reload();
    }
  };
  const startDrag = useDrag(move);

  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!rows) return html`<${Loading} />`;
  const stages = showClosed ? [...OPEN, ...CLOSED] : OPEN;
  const closedCount = rows.filter((c) => CLOSED.some((s) => s.value === c.stage)).length;
  const noNext = rows.filter((c) => OPEN.some((s) => s.value === c.stage) && !c.open_tasks).length;
  return html`<div>
    <div class="page-head">
      <div class="grow"><h1>Pipeline</h1>
        <div class="sub muted">${rows.length - closedCount} active · ${noNext ? html`<a class="due overdue" href="#/">${noNext} without a next step: work them from Today</a>` : 'every account has a next step'}</div></div>
      <button class="btn ghost" onClick=${() => setShowClosed(!showClosed)}>${showClosed ? 'Hide' : 'Show'} closed (${closedCount})</button>
      <button class="btn primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} /> Add accounts</button>
    </div>
    ${!rows.length ? html`<div class="card"><div class="empty">The pipeline is empty. <button class="btn primary small" onClick=${() => setAdding(true)}>Add your best-fit accounts</button></div></div>` : html`
    <div class=${`board ${showClosed ? 'with-closed' : ''}`}>
      ${stages.map((stage) => {
        const cards = rows.filter((c) => c.stage === stage.value).sort(byPriority);
        const limit = expanded[stage.value] ? cards.length : 12;
        return html`<section class=${`column ${cards.length ? '' : 'empty'}`} data-stage=${stage.value} key=${stage.value}
            title=${cards.length ? null : `No accounts in ${stage.label}. Drag a card here or use its advance button.`}>
          <header><span class="badge" style=${`--c:${stage.color}`}>${stage.label}</span><span class="n">${cards.length}</span></header>
          <div class="cards">
            ${cards.slice(0, limit).map((c) => html`<${Card} key=${c.id} c=${c} onMove=${move} startDrag=${startDrag} />`)}
            ${cards.length > limit && html`<button class="btn ghost small" onClick=${() => setExpanded((x) => ({ ...x, [stage.value]: true }))}>Show ${cards.length - limit} more</button>`}
          </div>
        </section>`;
      })}
    </div>`}
    ${adding && html`<${AddAccounts} onClose=${() => setAdding(false)} onAdded=${() => { setAdding(false); reload(); }} />`}
  </div>`;
}
