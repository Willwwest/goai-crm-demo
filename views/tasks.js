import { html, useState, useApi, useChanged, Loading, ErrorBox, Icon, toast, changed, fmtDate, dueClass, localDay } from '../lib/ui.js';
import { api } from '../lib/api.js';
import { personName } from '../schema.js';
import { OutcomeButtons, businessDaysAfter } from '../lib/actions.js';
import { openNew } from './quickadd.js';

// One task: check it off, push it, or open it to log what happened.
function TaskRow({ task, today, reload }) {
  const [open, setOpen] = useState(false);
  const done = async () => {
    try { await api.patch(`/api/tasks/${task.id}`, { done: !task.done_at }); changed(); reload(); } catch (e) { toast(e, 'error'); }
  };
  const push = async (days) => {
    try { await api.patch(`/api/tasks/${task.id}`, { due_date: businessDaysAfter(today, days) }); toast(`Moved to ${fmtDate(businessDaysAfter(today, days))}`); changed(); reload(); } catch (e) { toast(e, 'error'); }
  };
  const remove = async () => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    try { await api.del(`/api/tasks/${task.id}`); changed(); reload(); } catch (e) { toast(e, 'error'); }
  };
  const person = task.person_id ? { id: task.person_id, first_name: task.first_name, last_name: task.last_name } : null;
  const company = task.company_id ? { id: task.company_id, name: task.company_name, stage: task.company_stage } : null;
  return html`<li class=${`task-row ${task.done_at ? 'done' : ''} ${open ? 'open' : ''}`}>
    <div class="row task-main">
      <button class=${`check ${task.done_at ? 'on' : ''}`} onClick=${done} aria-label=${task.done_at ? 'Mark not done' : 'Mark done'}>${task.done_at && html`<${Icon} name="check" size=${14} />`}</button>
      <div class="grow">
        <div class="title">${task.title}</div>
        <div class="meta">
          ${company && html`<a href=${`#/companies/${company.id}`}>${company.name}</a>`}
          ${company && person && ' · '}
          ${person && html`<a href=${`#/people/${person.id}`}>${personName(person)}</a>`}
        </div>
      </div>
      ${task.due_date && html`<span class=${task.done_at ? 'due' : dueClass(task.due_date)}>${fmtDate(task.due_date)}</span>`}
      ${!task.done_at && company && html`<button class="btn small" onClick=${() => setOpen(!open)} aria-expanded=${open}>${open ? 'Close' : 'Log result'}</button>`}
      ${!task.done_at && html`<button class="btn small ghost" onClick=${() => push(1)} title="Move to the next business day">Tomorrow</button>`}
      <button class="btn ghost small icon" onClick=${remove} aria-label="Delete task"><${Icon} name="trash" size=${15} /></button>
    </div>
    ${open && company && html`<div class="task-outcome">
      <${OutcomeButtons} kind="task" company=${company} target=${person} connection=${null} task=${task} today=${today} onSaved=${() => { setOpen(false); reload(); }} />
    </div>`}
  </li>`;
}

function Group({ title, tone, tasks, today, reload }) {
  if (!tasks.length) return null;
  return html`<section class="card">
    <div class="head"><h2 class=${`grow ${tone ?? ''}`}>${title}</h2><span class="muted small">${tasks.length}</span></div>
    <div class="body flush"><ul class="items">${tasks.map((t) => html`<${TaskRow} key=${t.id} task=${t} today=${today} reload=${reload} />`)}</ul></div>
  </section>`;
}

export function Tasks() {
  const [status, setStatus] = useState('open');
  const { data, error, reload } = useApi(`/api/tasks?status=${status}&limit=1000`);
  useChanged(reload);
  const today = localDay();
  const week = businessDaysAfter(today, 5);
  let body;
  if (error) body = html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  else if (!data) body = html`<${Loading} />`;
  else if (status === 'done') body = data.length ? html`<${Group} title="Completed" tasks=${data} today=${today} reload=${reload} />` : html`<div class="card"><div class="empty">Nothing completed yet.</div></div>`;
  else if (!data.length) {
    body = html`<div class="card empty-state"><h2>No open tasks</h2><p class="muted">Tasks come from the follow-ups you set when you log a touch. Your next moves are waiting on Today.</p>
      <a class="btn primary" href="#/">Go to Today</a></div>`;
  } else {
    const groups = [
      ['Overdue', 'danger-text', data.filter((t) => t.due_date && t.due_date < today)],
      ['Today', null, data.filter((t) => t.due_date === today)],
      ['This week', null, data.filter((t) => t.due_date && t.due_date > today && t.due_date <= week)],
      ['Later', null, data.filter((t) => t.due_date && t.due_date > week)],
      ['No due date', null, data.filter((t) => !t.due_date)],
    ];
    body = html`<div class="stack">${groups.map(([title, tone, tasks]) => html`<${Group} key=${title} title=${title} tone=${tone} tasks=${tasks} today=${today} reload=${reload} />`)}</div>`;
  }
  const overdue = data && status === 'open' ? data.filter((t) => t.due_date && t.due_date < today).length : 0;
  return html`<div class="tasks-page">
    <div class="page-head">
      <div class="grow"><h1>Tasks</h1>${data && status === 'open' && html`<div class="sub muted">${data.length} open${overdue ? html` · <span class="due overdue">${overdue} overdue</span>` : ''}</div>`}</div>
      <div class="tabs">
        <button class=${status === 'open' ? 'on' : ''} onClick=${() => setStatus('open')}>Open</button>
        <button class=${status === 'done' ? 'on' : ''} onClick=${() => setStatus('done')}>Done</button>
      </div>
      <button class="btn primary" onClick=${() => openNew('tasks')}><${Icon} name="plus" size=${16} /> New task</button>
    </div>
    ${body}
  </div>`;
}
