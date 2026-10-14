import { html, useState, useApi, useChanged, Loading, ErrorBox, Icon, StageBadge, TierChip, FieldEditor, CompanyPicker, TaskItem, ACTIVITY_ICONS, toast, changed, navigate, fmtDate, fmtAgo, initials, localDay } from '../lib/ui.js';
import { api } from '../lib/api.js';
import { ENTITIES, STAGES, personName } from '../schema.js';
import { ActionPanel, ContactButtons, Snooze, bestBuyer, draftFor, pendingDemo, rankBuyers, replyWaiting, suggestNext, usePlan } from '../lib/actions.js';
import { openNew } from './quickadd.js';

const OPEN_STAGES = STAGES.filter((s) => !['nurture', 'lost', 'disqualified'].includes(s.value));
const CLOSED_STAGES = STAGES.filter((s) => ['nurture', 'lost', 'disqualified'].includes(s.value));

// ---- Pieces ------------------------------------------------------------------------------

function StageStepper({ stage, onChange }) {
  const [open, setOpen] = useState(false);
  const current = STAGES.findIndex((s) => s.value === stage);
  return html`<div class="stepper" role="group" aria-label="Stage">
    ${OPEN_STAGES.map((s, i) => {
      const at = s.value === stage;
      const past = current >= 0 && i < current && OPEN_STAGES.includes(STAGES[current]);
      return html`<button key=${s.value} class=${`step ${at ? 'at' : ''} ${past ? 'past' : ''}`} style=${`--c:${s.color}`}
        aria-current=${at ? 'step' : undefined} onClick=${() => !at && onChange(s.value)} title=${at ? `Current stage: ${s.label}` : `Move to ${s.label}`}>${s.label}</button>`;
    })}
    <div style="position:relative">
      <button class=${`step close ${CLOSED_STAGES.some((s) => s.value === stage) ? 'at' : ''}`} onClick=${() => setOpen(!open)} aria-haspopup="menu" aria-expanded=${open}>
        ${CLOSED_STAGES.find((s) => s.value === stage)?.label ?? 'Close'} ▾</button>
      ${open && html`<div class="menu" role="menu">
        ${CLOSED_STAGES.map((s) => html`<button role="menuitem" onClick=${() => { setOpen(false); onChange(s.value); }}><span class="stage-dot" style=${`background:${s.color}`} /> ${s.label}</button>`)}
        ${stage && html`<button role="menuitem" onClick=${() => { setOpen(false); onChange(null); }}>Remove from pipeline</button>`}
      </div>`}
    </div>
  </div>`;
}

function Details({ kind, record, company, save, open: initiallyOpen }) {
  const sections = [];
  for (const field of ENTITIES[kind].fields) {
    const name = field.section ?? 'Details';
    let section = sections.find((s) => s.name === name);
    if (!section) sections.push(section = { name, fields: [] });
    section.fields.push(field);
  }
  const filled = ENTITIES[kind].fields.filter((f) => record[f.key]).length;
  return html`<details class="card details-card" open=${initiallyOpen}>
    <summary class="head"><h2 class="grow">All details</h2><span class="small muted">${filled} of ${ENTITIES[kind].fields.length} filled</span></summary>
    <div class="body stack">
      ${sections.map((section) => html`<div class="fields" key=${section.name}>
        ${sections.length > 1 && html`<h3 class="section-title">${section.name}</h3>`}
        ${section.fields.map((field) => field.type === 'company'
          ? html`<div class="field-row" key=${field.key}><span class="label">${field.label}</span>
              <div class="with-action">
                <${CompanyPicker} value=${company?.name ?? ''} placeholder="Link a company" onPick=${(c) => save(c.id ? { company_id: c.id } : { company_name: c.name })} />
                ${company && html`<button class="btn icon" aria-label="Unlink company" onClick=${() => save({ company_id: null })}><${Icon} name="x" size=${16} /></button>`}
              </div></div>`
          : html`<${FieldEditor} key=${field.key} field=${field} value=${record[field.key]} onSave=${(value) => save({ [field.key]: value })} />`)}
      </div>`)}
      <div class="small faint">Created ${fmtDate(record.created_at, { year: true })} · Updated ${fmtAgo(record.updated_at)}</div>
    </div>
  </details>`;
}

function Timeline({ activities, kind, record, onChange }) {
  const [note, setNote] = useState('');
  const remove = async (a) => {
    if (!confirm('Delete this activity?')) return;
    try { await api.del(`/api/activities/${a.id}`); onChange(); } catch (error) { toast(error, 'error'); }
  };
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      await api.post('/api/activities', { type: 'Note', summary: note.trim(), ...(kind === 'companies' ? { company_id: record.id } : { person_id: record.id }) });
      setNote('');
      onChange();
    } catch (error) { toast(error, 'error'); }
  };
  const real = activities.filter((a) => a.type !== 'Stage change');
  return html`<section class="card">
    <div class="head"><h2 class="grow">History</h2><span class="muted small">${real.length} touch${real.length === 1 ? '' : 'es'}</span></div>
    <form class="note-form" onSubmit=${addNote}>
      <input class="input" placeholder="Add a note…" value=${note} onInput=${(e) => setNote(e.target.value)} aria-label="Add a note" />
      <button class="btn" disabled=${!note.trim()}>Add</button>
    </form>
    <div class="body flush">
      ${activities.length ? html`<ul class="timeline">${activities.map((a) => a.type === 'Stage change'
        ? html`<li class="system" key=${a.id}><span class="dot"><${Icon} name="board" size=${14} /></span><span class="grow">Stage ${a.summary}</span><span>${fmtDate(a.at)}</span></li>`
        : html`<li key=${a.id}>
          <span class=${`dot ${a.type === 'Note' ? '' : 'accent'}`}><${Icon} name=${ACTIVITY_ICONS[a.type] ?? 'note'} size=${15} /></span>
          <div class="grow">
            <div class="row wrap"><strong>${a.summary || a.type}</strong></div>
            <div class="small muted">
              ${[a.type, a.channel, fmtDate(a.at), a.scheduled_for && `for ${fmtDate(a.scheduled_for)}`].filter(Boolean).join(' · ')}
              ${kind === 'companies' && a.person_id && html` · <a href=${`#/people/${a.person_id}`}>${personName(a)}</a>`}
              ${kind === 'people' && a.company_id && html` · <a href=${`#/companies/${a.company_id}`}>${a.company_name}</a>`}
            </div>
            ${a.body && html`<div class="body">${a.body}</div>`}
          </div>
          <div class="actions"><button class="btn ghost small icon" onClick=${() => remove(a)} aria-label="Delete activity"><${Icon} name="trash" size=${15} /></button></div>
        </li>`)}</ul>` : html`<div class="empty">No history yet. Log the first touch above.</div>`}
    </div>
  </section>`;
}

function Tasks({ kind, record, tasks, onChange }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const add = async (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await api.post('/api/tasks', { title, due_date: due || null, ...(kind === 'companies' ? { company_id: record.id } : { person_id: record.id }) });
      setTitle(''); setDue('');
      onChange();
    } catch (error) { toast(error, 'error'); }
  };
  const open = tasks.filter((t) => !t.done_at);
  return html`<section class="card">
    <div class="head"><h2 class="grow">Open tasks</h2><span class="muted small">${open.length}</span></div>
    <div class="body flush">
      ${open.length > 0 && html`<ul class="items">${open.map((t) => html`<${TaskItem} key=${t.id} task=${t} onChange=${onChange} showLink=${kind === 'companies' && !!t.person_id} />`)}</ul>`}
      <form class="row task-add" onSubmit=${add}>
        <input class="input grow" placeholder="Add a task" value=${title} onInput=${(e) => setTitle(e.target.value)} aria-label="New task" />
        <input class="input" type="date" style="width:auto" value=${due} onInput=${(e) => setDue(e.target.value)} aria-label="Due date" />
        <button class="btn" aria-label="Add task" disabled=${!title.trim()}><${Icon} name="plus" size=${16} /></button>
      </form>
    </div>
  </section>`;
}

function PersonRow({ p, company, tag }) {
  return html`<li key=${p.id}>
    <a class="avatar round sm" href=${`#/people/${p.id}`}>${initials(personName(p))}</a>
    <div class="grow">
      <a class="title" href=${`#/people/${p.id}`}>${personName(p)}</a>${tag && html` <span class="badge plain target-badge">${tag}</span>`}
      <div class="meta ellipsis">${p.title || 'No title'}</div>
    </div>
    <div class="row icon-actions">
      ${p.email && html`<a class="btn ghost small icon" href=${`mailto:${p.email}`} aria-label=${`Email ${personName(p)}`}><${Icon} name="mail" size=${15} /></a>`}
      <a class="btn ghost small icon" href=${p.linkedin_url || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${personName(p)} ${company?.name ?? ''}`)}`}
        target="_blank" rel="noopener noreferrer" aria-label=${`${personName(p)} on LinkedIn`}><${Icon} name="external" size=${15} /></a>
    </div>
  </li>`;
}

function People({ company, people }) {
  const [showAll, setShowAll] = useState(false);
  // Buyers in the order the next step picks them, so the first one is the person to reach.
  const buyers = rankBuyers(people);
  const warm = people.filter((p) => p.relationship === 'Connection');
  const others = people.filter((p) => p.relationship !== 'Buyer' && p.relationship !== 'Connection');
  return html`<section class="card">
    <div class="head"><h2 class="grow">People</h2>
      <button class="btn small" onClick=${() => openNew('people', { company_id: company.id, company_label: company.name, relationship: 'Buyer' })}><${Icon} name="plus" size=${14} /> Add</button></div>
    <div class="body flush">
      ${!people.length && html`<div class="empty">No contacts yet. Add the person who owns AI or infrastructure here.</div>`}
      ${buyers.length > 0 && html`<div class="group-label">Buyers</div><ul class="items">${buyers.map((p, i) => html`<${PersonRow} p=${p} company=${company} tag=${i === 0 && buyers.length > 1 ? 'Start here' : null} />`)}</ul>`}
      ${warm.length > 0 && html`<div class="group-label">You know</div><ul class="items">${warm.map((p) => html`<${PersonRow} p=${p} company=${company} />`)}</ul>`}
      ${others.length > 0 && html`<div class="group-label">
          <button class="link-button" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Hide' : 'Show'} ${others.length} other contact${others.length === 1 ? '' : 's'}</button></div>
        ${showAll && html`<ul class="items">${others.slice(0, 100).map((p) => html`<${PersonRow} p=${p} company=${company} />`)}</ul>`}`}
    </div>
  </section>`;
}

// "Why: ..." and "Offer: ..." from research notes, when present.
function note(text, label, until) {
  const m = new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\s*(?:${until.join('|')}):|$)`).exec(text ?? '');
  return m?.[1]?.trim() || null;
}

function TalkingPoints({ record }) {
  const why = note(record.hypothesis, 'Why', ['Offer', 'Scoring note']);
  const offer = note(record.hypothesis, 'Offer', ['Scoring note']);
  if (!why && !offer && !record.decision_path && !record.buyer_pain) return null;
  return html`<section class="card">
    <div class="head"><h2 class="grow">Talking points</h2></div>
    <div class="body talking">
      ${why && html`<p><strong>Why them</strong>${why}</p>`}
      ${offer && html`<p><strong>What to pitch</strong>${offer}</p>`}
      ${record.buyer_pain && html`<p><strong>Confirmed pain</strong>${record.buyer_pain}</p>`}
      ${record.decision_path && html`<p><strong>Who decides</strong>${record.decision_path}</p>`}
    </div>
  </section>`;
}

function DeleteMenu({ label, onDelete }) {
  const [open, setOpen] = useState(false);
  return html`<div style="position:relative">
    <button class="btn ghost icon" onClick=${() => setOpen(!open)} aria-label="More actions" aria-haspopup="menu" aria-expanded=${open}><${Icon} name="more" size=${18} /></button>
    ${open && html`<div class="menu" role="menu"><button role="menuitem" class="danger-item" onClick=${() => { setOpen(false); onDelete(); }}><${Icon} name="trash" size=${15} /> Delete ${label}</button></div>`}
  </div>`;
}

// ---- Pages --------------------------------------------------------------------------------------

function CompanyPage({ data, reload, save, remove }) {
  const plan = usePlan();
  const { record, people, tasks, activities } = data;
  const today = localDay();
  const openTask = tasks.find((t) => !t.done_at) ?? null;
  const demo = pendingDemo(activities);
  const replied = replyWaiting(activities);
  const lastReply = replied ? activities.find((a) => a.type === 'Reply') : null;
  // The person a booked demo or a reply is with comes before the usual best buyer.
  const target = people.find((p) => p.id === (demo?.person_id ?? lastReply?.person_id)) ?? bestBuyer(people);
  const connection = people.find((p) => p.relationship === 'Connection') ?? null;
  const touched = activities.some((a) => a.type !== 'Stage change');
  const next = suggestNext({ task: openTask, target, connection, touched, demo, replied, today });
  const outbound = activities.filter((a) => a.type === 'Outreach' || a.type === 'Call').length;
  const domain = record.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const meta = [record.segment, [record.city, record.state].filter(Boolean).join(', '), record.product_fit].filter(Boolean);
  const setStage = async (stage) => {
    try { await api.patch(`/api/companies/${record.id}`, { stage }); toast(stage ? `Moved to ${STAGES.find((s) => s.value === stage).label}` : 'Removed from pipeline'); reload(); changed(); } catch (error) { toast(error, 'error'); }
  };
  return html`<div class="record">
    <div class="record-head">
      <span class="avatar">${initials(record.name)}</span>
      <div class="grow">
        <div class="row wrap"><h1>${record.name}</h1><${TierChip} tier=${record.tier} />${record.fit_score != null && html`<span class="fit-pill">Fit ${record.fit_score}</span>`}</div>
        <div class="row wrap muted small" style="margin-top:4px">${meta.map((m, i) => html`${i ? html`<span class="faint">·</span>` : ''}<span>${m}</span>`)}
          ${domain && html`<span class="faint">·</span><a href=${record.website} target="_blank" rel="noopener noreferrer">${domain}</a>`}</div>
      </div>
      <${DeleteMenu} label="company" onDelete=${remove} />
    </div>
    <${StageStepper} stage=${record.stage} onChange=${setStage} />
    <div class="record-grid">
      <div class="stack">
        <section class="card next-move compact">
          <div class="nm-top"><span class="nm-label">Next step</span><span class="spacer" />${record.stage_entered_at && html`<span class="small muted">In ${STAGES.find((s) => s.value === record.stage)?.label ?? 'stage'} since ${fmtDate(record.stage_entered_at)}</span>`}</div>
          <${ActionPanel} kind=${next.kind} action=${next.action} company=${record} target=${target} connection=${connection} task=${openTask}
            demo=${demo} outbound=${outbound} today=${today} me=${plan?.name} onSaved=${reload} />
          <div class="nm-secondary"><span class="spacer" /><${Snooze} company=${record} title=${next.action} today=${today} onDone=${reload} /></div>
        </section>
        <${Timeline} activities=${activities} kind="companies" record=${record} onChange=${reload} />
      </div>
      <div class="stack">
        <${People} company=${record} people=${people} />
        <${TalkingPoints} record=${record} />
        <${Tasks} kind="companies" record=${record} tasks=${tasks} onChange=${reload} />
        <${Details} kind="companies" record=${record} save=${save} />
      </div>
    </div>
  </div>`;
}

function PersonPage({ data, reload, save, remove }) {
  const plan = usePlan();
  const { record, company, colleagues = [], tasks, activities } = data;
  const today = localDay();
  const openTask = tasks.find((t) => !t.done_at) ?? null;
  const touched = activities.some((a) => a.type !== 'Stage change');
  const isConnection = record.relationship === 'Connection';
  // A connection's page asks them for an introduction to the company's best buyer.
  const target = isConnection ? bestBuyer(colleagues) : record;
  const demo = isConnection ? null : pendingDemo(activities);
  const next = isConnection && !openTask
    ? suggestNext({ task: null, target, connection: record, touched: false })
    : suggestNext({ task: openTask, target: record, connection: null, touched, demo, replied: replyWaiting(activities), today });
  const account = company ?? { id: null, name: personName(record), stage: null };
  // Header buttons reach this person, so their Email link carries the step's draft.
  const draft = next.kind === 'research' ? null
    : draftFor({ kind: next.kind, company: account, target, connection: isConnection ? record : null, me: plan?.name, demo, today });
  return html`<div class="record">
    <div class="record-head">
      <span class="avatar round">${initials(personName(record))}</span>
      <div class="grow">
        <div class="row wrap"><h1>${personName(record)}</h1>${record.relationship && html`<span class=${`badge plain rel-${record.relationship.toLowerCase()}`}>${isConnection ? 'Your connection' : record.relationship}</span>`}</div>
        <div class="row wrap muted" style="margin-top:4px">
          ${record.title && html`<span>${record.title}</span>`}
          ${company && html`<span>at <a href=${`#/companies/${company.id}`}>${company.name}</a></span><${TierChip} tier=${company.tier} /><${StageBadge} stage=${company.stage} />`}
        </div>
      </div>
      <${ContactButtons} person=${record} company=${company} draft=${draft} />
      <${DeleteMenu} label="person" onDelete=${remove} />
    </div>
    <div class="record-grid">
      <div class="stack">
        <section class="card next-move compact">
          <div class="nm-top"><span class="nm-label">Next step</span></div>
          <${ActionPanel} kind=${next.kind} action=${next.action} company=${account} target=${target} connection=${isConnection ? record : null}
            task=${openTask} demo=${demo} outbound=${activities.filter((a) => a.type === 'Outreach' || a.type === 'Call').length}
            today=${today} me=${plan?.name} onSaved=${reload} showReach=${false} />
        </section>
        <${Timeline} activities=${activities} kind="people" record=${record} onChange=${reload} />
      </div>
      <div class="stack">
        ${colleagues.length > 0 && html`<section class="card">
          <div class="head"><h2 class="grow">Also at ${company?.name}</h2></div>
          <div class="body flush"><ul class="items">${colleagues.map((p) => html`<${PersonRow} p=${p} company=${company} />`)}</ul></div>
        </section>`}
        <${Tasks} kind="people" record=${record} tasks=${tasks} onChange=${reload} />
        <${Details} kind="people" record=${record} company=${company} save=${save} />
      </div>
    </div>
  </div>`;
}

export function RecordPage({ kind, id }) {
  const { data, error, loading, reload } = useApi(`/api/${kind}/${id}`);
  useChanged(reload);
  if (error) return html`<div class="stack"><a href=${`#/${kind}`} class="btn ghost" style="align-self:flex-start"><${Icon} name="back" size=${16} /> ${ENTITIES[kind].label}</a><${ErrorBox} error=${error} onRetry=${reload} /></div>`;
  if (!data || (loading && data.record?.id !== id)) return html`<${Loading} />`;
  const { record } = data;
  const save = async (patch) => { await api.patch(`/api/${kind}/${id}`, patch); reload(); };
  const remove = async () => {
    const label = kind === 'companies' ? record.name : personName(record);
    const extra = kind === 'companies' ? ' Its activity and tasks are deleted; linked people are kept.' : '';
    if (!confirm(`Delete ${label}?${extra}`)) return;
    try { await api.del(`/api/${kind}/${id}`); toast(`${label} deleted`); navigate(`/${kind}`); changed(); } catch (err) { toast(err, 'error'); }
  };
  return kind === 'companies'
    ? html`<${CompanyPage} data=${data} reload=${reload} save=${save} remove=${remove} />`
    : html`<${PersonPage} data=${data} reload=${reload} save=${save} remove=${remove} />`;
}
