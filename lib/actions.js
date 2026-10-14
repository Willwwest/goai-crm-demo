// The action kit shared by Today, company and person pages, and Tasks: what to do
// next, a message draft (a template, or written by the AI on request), ways to reach the
// person, and one-tap outcome logging, including booked and held demos.
import { html, useState, useEffect, StageBadge, Icon, toast, changed, fmtDate } from './ui.js';
import { api } from './api.js';
import { STAGES, personName, roleGroup } from '../schema.js';
import { AiButton, aiCall, BriefModal, NotesModal, ReplyModal } from './ai.js';

// People arrive either with first/last names (API records) or a ready `name` (Today queue).
export const nameOf = (p) => p?.name ?? personName(p);

// ---- Dates --------------------------------------------------------------------

export const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const businessDaysAfter = (day, n) => {
  let d = day;
  for (let left = n; left > 0;) {
    d = addDays(d, 1);
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return d;
};
// "Today", "Tomorrow" or "Thu, Oct 15".
export function dayLabel(day, today) {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---- Your plan (name for drafts), fetched once ------------------------------------

let planCache = null;
const planListeners = new Set();
export function usePlan() {
  const [plan, setPlan] = useState(planCache);
  useEffect(() => {
    planListeners.add(setPlan);
    if (!planCache) api.get('/api/plan').then((p) => { planCache = p; planListeners.forEach((fn) => fn(p)); }, () => {});
    return () => planListeners.delete(setPlan);
  }, []);
  return plan;
}
export const refreshPlan = (plan) => { planCache = plan; planListeners.forEach((fn) => fn(plan)); };

// ---- What to do next ------------------------------------------------------------------

// The buyer to aim at first, in the same order the Today queue uses: technology owners,
// then executives, then security, risk, strategy and clinical roles.
const ROLE_ORDER = ['Technology', 'Executive', 'Security', 'Risk & compliance', 'Strategy & AI', 'Clinical', 'Other'];
export function rankBuyers(people) {
  const rank = (p) => { const i = ROLE_ORDER.indexOf(roleGroup(p.title)); return i < 0 ? ROLE_ORDER.length : i; };
  return people.filter((p) => p.relationship === 'Buyer').sort((a, b) => rank(a) - rank(b));
}
export const bestBuyer = (people) => rankBuyers(people)[0] ?? null;

// From an account's history (newest first): the booked demo still open, if any, and
// whether the last exchange was a reply waiting on you.
export function pendingDemo(activities) {
  for (const a of activities) {
    if (a.type === 'Demo held') return null;
    if (a.type === 'Demo booked') return a.scheduled_for ? { id: a.id, date: a.scheduled_for, person_id: a.person_id } : null;
  }
  return null;
}
export const replyWaiting = (activities) => activities.find((a) => a.type !== 'Note' && a.type !== 'Stage change')?.type === 'Reply';

// Mirrors the Today queue: a demo that needs an outcome or prep, a reply waiting on you,
// an open task, then an intro through a connection when the account is untouched, then
// finding a buyer, first outreach, or a follow-up.
export function suggestNext({ task, target, connection, touched, demo, replied, today }) {
  const who = target ? `${nameOf(target)}${target.title ? `, ${target.title}` : ''}` : null;
  if (demo && demo.date < today) return { kind: 'demo', action: `Did the demo with ${target ? nameOf(target) : 'them'} happen?` };
  if (demo) return { kind: 'prep', action: `Prepare for the demo with ${target ? nameOf(target) : 'them'}` };
  if (replied && !demo) return { kind: 'reply', action: `Answer ${target ? nameOf(target) : 'their reply'} and offer demo times` };
  if (task) return { kind: 'task', action: task.title };
  if (connection && !touched) return { kind: 'intro', action: `Ask ${nameOf(connection)} for an introduction${who ? ` to ${who}` : ''}` };
  if (!target) return { kind: 'research', action: 'Find a buyer contact' };
  if (!touched) return { kind: 'outreach', action: `First outreach to ${who}` };
  return { kind: 'follow', action: `Follow up with ${who}` };
}

// ---- Outcomes ---------------------------------------------------------------------------

// `stage` follows lead-generation-process.md: a first outbound touch is Contacted, a
// two-way exchange is Engaged, a live discussion is Discovery. An intro request goes to
// your connection, not the buyer, so it does not move the stage. `demo` outcomes ask for
// the demo date; `change` outcomes move or cancel the booked demo.
export const OUTCOMES = {
  intro: { label: 'Asked for intro', type: 'Intro request', channel: 'LinkedIn', who: 'connection', days: 3,
    summary: (c, t) => `Asked ${c} for an intro${t ? ` to ${t}` : ''}`, next: (c) => `Follow up with ${c} on the intro` },
  introMade: { label: 'Intro made', type: 'Reply', channel: 'Email', who: 'target', days: 1, stage: 'engaged',
    summary: (c, t) => `${c} introduced ${t}`, next: (c, t) => `Thank ${c} and offer ${t} demo times` },
  email: { label: 'Emailed', type: 'Outreach', channel: 'Email', who: 'target', days: 4, stage: 'contacted',
    summary: (c, t) => `Emailed ${t}`, next: (c, t) => `Follow up with ${t}` },
  linkedin: { label: 'Messaged on LinkedIn', type: 'Outreach', channel: 'LinkedIn', who: 'target', days: 4, stage: 'contacted',
    summary: (c, t) => `Messaged ${t} on LinkedIn`, next: (c, t) => `Follow up with ${t}` },
  call: { label: 'Called', type: 'Call', channel: 'Phone', who: 'target', days: 2, stage: 'contacted',
    summary: (c, t) => `Called ${t}`, next: (c, t) => `Call ${t} again` },
  reply: { label: 'Got a reply', type: 'Reply', channel: null, who: 'target', days: 1, stage: 'engaged',
    summary: (c, t) => `Reply from ${t}`, next: (c, t) => `Offer ${t} demo times` },
  booked: { label: 'Demo booked', type: 'Demo booked', channel: null, who: 'target', days: 3, stage: 'engaged', demo: true,
    summary: (c, t) => `Demo booked with ${t}` },
  met: { label: 'Demo held', type: 'Demo held', channel: 'Video', who: 'target', days: 1, stage: 'discovery',
    summary: (c, t) => `Demo with ${t}`, next: (c, t) => `Send ${t} a recap and next steps` },
  moved: { label: 'Rescheduled', change: 'reschedule', days: 3 },
  missed: { label: 'Didn’t happen', change: 'cancel', days: 1, next: (c, t) => `Rebook the demo with ${t}` },
  note: { label: 'Note', type: 'Note', channel: null, who: 'target', days: 3, summary: () => 'Note', next: () => '' },
};
export const OUTCOME_SETS = {
  intro: ['intro', 'introMade', 'email', 'call'],
  outreach: ['email', 'linkedin', 'call', 'booked'],
  follow: ['email', 'call', 'reply', 'booked'],
  task: ['email', 'call', 'reply', 'booked', 'met'],
  reply: ['booked', 'email', 'call'],
  prep: ['met', 'moved', 'missed'],
  demo: ['met', 'moved', 'missed'],
  research: [],
};
const stageIndex = (value) => STAGES.findIndex((s) => s.value === value);

// Logs an outcome: the activity with its next step (or the demo date), the stage move and
// the task it completes. A rescheduled or missed demo updates the booking instead.
export async function saveOutcome({ outcome, company, target, connection, task, demo, v }) {
  const o = OUTCOMES[outcome];
  const next = v.next?.trim() || null;
  if (o.change) {
    await api.post(`/api/demos/${demo.id}`, { action: o.change, date: v.due, body: v.body, next_action: next, next_due: next ? v.due : null });
  } else {
    const person = o.who === 'connection' ? connection : target;
    await api.post('/api/activities', {
      company_id: company.id, person_id: person?.id ?? null, type: o.type, channel: o.channel, summary: v.summary, body: v.body,
      ...(o.demo ? { scheduled_for: v.due } : { next_action: next, next_due: next ? v.due : null }),
    });
  }
  if (v.advance && v.stage && company.id) await api.patch(`/api/companies/${company.id}`, { stage: v.stage });
  if (v.complete && task) await api.patch(`/api/tasks/${task.id}`, { done: true });
  toast(`${o.label}: ${company.name}`);
  changed();
}

// The values an outcome starts with; `initial` (from the AI reading a reply or notes) overrides them.
export function outcomeDefaults({ outcome, company, target, connection, task, today, initial = {} }) {
  const o = OUTCOMES[outcome];
  const c = connection ? nameOf(connection) : 'your connection';
  const t = target ? nameOf(target) : 'the buyer';
  const stage = initial.stage ?? o.stage;
  const advance = !o.change && !!company.id && !!stage && stageIndex(stage) > stageIndex(company.stage);
  return {
    summary: initial.summary ?? o.summary?.(c, t) ?? '', body: initial.body ?? '', next: initial.next ?? o.next?.(c, t) ?? '',
    due: initial.due ?? businessDaysAfter(today, o.days), stage, advance, canAdvance: advance, complete: !!task && !o.change,
  };
}

// ---- Message drafts ------------------------------------------------------------------------

const SEGMENT_WORDS = {
  Healthcare: { data: 'patient data', peers: 'health systems' },
  Insurance: { data: 'policyholder data', peers: 'insurers' },
  Bank: { data: 'customer financial data', peers: 'banks' },
  'Credit union': { data: 'member data', peers: 'credit unions' },
};
const firstName = (p) => (p?.first_name ?? nameOf(p).split(' ')[0] ?? '').replace(/[^A-Za-z'-].*$/, '') || 'there';

// A starting point for the message this step needs; always editable before sending.
export function draftFor({ kind, company, target, connection, me, demo, today }) {
  const words = SEGMENT_WORDS[company?.segment] ?? { data: 'sensitive data', peers: 'organizations' };
  const sign = me || '[Your name]';
  // A person with no company gets a stand-in account with no id; don't name it in the message.
  const org = (company?.id && company.name) || 'your team';
  if (kind === 'intro' && connection) {
    const t = target ? `${nameOf(target)}${target.title ? ` (${target.title})` : ''}` : `the person who owns AI and infrastructure at ${org}`;
    return {
      to: connection, subject: `Quick intro at ${org}?`,
      body: `Hi ${firstName(connection)},\n\nHope you're doing well. I recently joined Go.AI. We help organizations run AI on hardware they control, so ${words.data} stays inside their own environment.\n\nWould you be open to introducing me to ${t}? I can send a two-line note you could forward, and no worries if the timing is wrong.\n\nThanks,\n${sign}`,
    };
  }
  if (!target) return null;
  if (kind === 'reply' && today) {
    const [a, b] = [businessDaysAfter(today, 2), businessDaysAfter(today, 4)].map((d) => dayLabel(d, today));
    return {
      to: target, subject: `Re: AI on hardware you control at ${org}`,
      body: `Hi ${firstName(target)},\n\nThanks for getting back to me. Would 20 minutes on ${a} or ${b} work to walk through it? I'm happy to work around your calendar.\n\n${sign}`,
    };
  }
  if ((kind === 'prep' || kind === 'demo') && demo && today) {
    return {
      to: target, subject: `Our conversation ${dayLabel(demo.date, today).toLowerCase() === 'today' ? 'today' : `on ${dayLabel(demo.date, today)}`}`,
      body: `Hi ${firstName(target)},\n\nLooking forward to our conversation. Is there one workflow you'd most like to see, and should anyone from security or IT join us?\n\n${sign}`,
    };
  }
  if (kind === 'follow' || kind === 'task') {
    return {
      to: target, subject: `Re: AI on hardware you control at ${org}`,
      body: `Hi ${firstName(target)},\n\nFollowing up on my note. If keeping AI work inside your own environment is on your list this year, I can show what that looks like for a team like yours in 20 minutes. If the timing is wrong, tell me when to check back.\n\n${sign}`,
    };
  }
  return {
    to: target, subject: `AI that keeps ${words.data} inside ${org}`,
    body: `Hi ${firstName(target)},\n\nI work with ${words.peers} that want generative AI without sending ${words.data} to a cloud model. Go.AI runs the models on hardware inside your own environment, with the same permissions as the systems they search.\n\nWould 20 minutes in the next two weeks be worth it to see whether it fits ${org}?\n\n${sign}`,
  };
}

// ---- Reaching a person ------------------------------------------------------------------------

export function ContactButtons({ person, company, draft, small }) {
  if (!person) return null;
  const size = small ? 'small' : '';
  const name = nameOf(person);
  const mail = person.email
    ? `mailto:${person.email}${draft ? `?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}` : ''}` : null;
  const linkedin = person.linkedin_url || `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${company?.name ?? ''}`.trim())}`;
  return html`<div class="contact-buttons">
    ${mail && html`<a class=${`btn ${size}`} href=${mail}><${Icon} name="mail" size=${15} /> Email</a>`}
    <a class=${`btn ${size}`} href=${linkedin} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${15} /> ${person.linkedin_url ? 'LinkedIn' : 'Find on LinkedIn'}</a>
    ${person.phone && html`<a class=${`btn ${size}`} href=${`tel:${person.phone}`}><${Icon} name="phone" size=${15} /> Call</a>`}
  </div>`;
}

export function Draft({ draft, onEdit, label, actions }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft.subject ? `Subject: ${draft.subject}\n\n${draft.body}` : draft.body); toast('Message copied'); } catch { toast('Select the text and copy it', 'error'); }
  };
  return html`<div class="draft">
    <div class="row wrap"><span class="draft-label grow">${label ?? `Suggested message to ${nameOf(draft.to)}`}</span>
      ${actions}
      <button type="button" class="btn small" onClick=${copy}><${Icon} name="note" size=${14} /> Copy</button></div>
    ${draft.subject !== '' && draft.subject != null && html`<input class="input draft-subject" value=${draft.subject} onInput=${(e) => onEdit({ subject: e.target.value })} aria-label="Subject" />`}
    <textarea class="input draft-text" rows=${Math.min(12, draft.body.split('\n').length + 1)} value=${draft.body} onInput=${(e) => onEdit({ body: e.target.value })} aria-label="Message" />
  </div>`;
}

// ---- Logging an outcome -------------------------------------------------------------------------

export function OutcomePanel({ company, target, connection, task, demo, outcome, today, initial, onCancel, onSaved }) {
  const o = OUTCOMES[outcome];
  const [v, setV] = useState(() => outcomeDefaults({ outcome, company, target, connection, task, today, initial }));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await saveOutcome({ outcome, company, target, connection, task, demo, v });
      onSaved?.();
    } catch (error) {
      toast(error, 'error');
      setSaving(false);
    }
  };
  const datePicker = o.demo || o.change === 'reschedule';
  const presets = [['Tomorrow', 1], ['In 3 days', 3], ['Next week', 5]];
  const dates = html`<div class="field"><span class="small muted" style="font-weight:600">${o.demo ? 'Demo date' : datePicker ? 'New demo date' : 'Due'}</span>
    <div class="row wrap">
      ${presets.map(([label, n]) => {
        const d = businessDaysAfter(today, n);
        return html`<button type="button" class=${`chip ${v.due === d ? 'on' : ''}`} onClick=${() => setV({ ...v, due: d })}>${label}</button>`;
      })}
      <input class="input due-input" type="date" value=${v.due} onInput=${set('due')} aria-label=${datePicker ? 'Demo date' : 'Due date'} />
    </div>
  </div>`;
  return html`<form class="outcome-panel" onSubmit=${save}>
    ${o.change ? html`<div class="row"><span class="outcome-check"><${Icon} name="calendar" size=${16} /></span><strong>${o.change === 'reschedule' ? 'Move the demo' : 'The demo did not happen'}</strong>${demo && html`<span class="small muted">booked for ${fmtDate(demo.date)}</span>`}</div>`
      : html`<div class="row"><span class="outcome-check"><${Icon} name="check" size=${16} /></span>
        <input class="input outcome-summary" value=${v.summary} onInput=${set('summary')} aria-label="What happened" /></div>`}
    <textarea class="input" rows=${v.body ? Math.min(8, v.body.split('\n').length + 1) : 2} placeholder="Notes (optional)" value=${v.body} onInput=${set('body')} />
    ${datePicker ? dates : html`<div class="next-step">
      <label class="field grow"><span>Next step</span><input class="input" value=${v.next} onInput=${set('next')} placeholder="Leave blank for none" /></label>
      ${dates}
    </div>`}
    ${v.canAdvance && html`<label class="row small"><input type="checkbox" checked=${v.advance} onChange=${set('advance')} /> Move to <${StageBadge} stage=${v.stage} /></label>`}
    ${task && !o.change && html`<label class="row small"><input type="checkbox" checked=${v.complete} onChange=${set('complete')} /> Mark “${task.title}” done</label>`}
    <div class="row wrap">
      <button class="btn primary" disabled=${saving}>${saving ? 'Saving…' : 'Save'}</button>
      ${onCancel && html`<button type="button" class="btn ghost" onClick=${onCancel}>Cancel</button>`}
    </div>
  </form>`;
}

export function Snooze({ company, title, today, onDone }) {
  const [open, setOpen] = useState(false);
  const snooze = async (days, label) => {
    setOpen(false);
    try {
      await api.post('/api/tasks', { title: `Revisit: ${title}`, due_date: businessDaysAfter(today, days), company_id: company.id });
      toast(`${company.name} snoozed until ${label.toLowerCase()}`);
      changed();
      onDone?.();
    } catch (error) { toast(error, 'error'); }
  };
  return html`<div style="position:relative">
    <button type="button" class="btn ghost" onClick=${() => setOpen(!open)} aria-haspopup="menu" aria-expanded=${open}>Snooze <span class="faint">▾</span></button>
    ${open && html`<div class="menu" role="menu" style="left:0;right:auto">
      ${[['Tomorrow', 1], ['Next week', 5], ['In two weeks', 10]].map(([label, n]) => html`<button role="menuitem" onClick=${() => snooze(n, label)}>${label}<span class="spacer" /><span class="faint small">${fmtDate(businessDaysAfter(today, n))}</span></button>`)}
    </div>`}
  </div>`;
}

// What happened? Outcome buttons, with the inline panel once one is picked. A step
// with no buyer yet offers the research actions instead. `sent` is the message you
// wrote here; logging a message keeps it in the history, where follow-ups can see it.
export function OutcomeButtons({ kind, company, target, connection, task, demo, sent, today, onSaved }) {
  const [outcome, setOutcome] = useState(null);
  useEffect(() => setOutcome(null), [company.id, kind, target?.id]);
  if (outcome) {
    const message = sent && ['Outreach', 'Intro request'].includes(OUTCOMES[outcome].type);
    return html`<${OutcomePanel} key=${outcome} company=${company} target=${target} connection=${connection} task=${task} demo=${demo}
      outcome=${outcome} today=${today} initial=${message ? { body: sent } : undefined}
      onCancel=${() => setOutcome(null)} onSaved=${() => { setOutcome(null); onSaved?.(); }} />`;
  }
  if (kind === 'research') {
    const search = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company.name} CIO`)}`;
    return html`<div class="nm-outcomes">
      <a class="btn primary" href=${search} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${16} /> Find a buyer on LinkedIn</a>
      <a class="btn" href=${`#/companies/${company.id}`}><${Icon} name="plus" size=${16} /> Add them to ${company.name}</a>
    </div>`;
  }
  // Once a buyer has replied (Engaged), booking the demo is the outcome to lead with.
  // Rescheduling or cancelling needs the booking itself.
  const set = OUTCOME_SETS[kind].filter((k) => !OUTCOMES[k].change || demo);
  const keys = company.stage === 'engaged' && set.includes('booked') ? ['booked', ...set.filter((k) => k !== 'booked')] : set;
  return html`<div class="outcome-group">
    <div class="outcome-prompt">What happened?</div>
    <div class="nm-outcomes" role="group" aria-label="What happened">
      ${keys.map((k, i) => html`<button type="button" class=${`btn outcome ${i === 0 ? 'primary' : ''}`} onClick=${() => setOutcome(k)}>${OUTCOMES[k].label}</button>`)}
    </div>
  </div>`;
}

// The full next-step block: the action, who to reach and how, a draft the AI can write,
// and outcome logging. `showReach` is off on a person's own page, where the header
// already has their contact buttons.
export function ActionPanel({ kind, action, company, target, connection, task, demo, outbound = 0, today, me, onSaved, showDraft = true, showReach = true }) {
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState(null);
  const [busy, setBusy] = useState(null);
  const [modal, setModal] = useState(null);
  useEffect(() => { setOpen(false); setEdits(null); }, [company.id, kind, target?.id]);
  const template = showDraft && kind !== 'research' ? draftFor({ kind, company, target, connection, me, demo, today }) : null;
  const draft = template && { ...template, ...edits };
  const reach = kind === 'intro' ? connection : target;
  const write = async (channel) => {
    setBusy(channel);
    try {
      const res = await aiCall('draft', { company_id: company.id, person_id: target?.id ?? null, connection_id: connection?.id ?? null, kind, channel, touch: outbound + 1 });
      setEdits({ subject: channel === 'linkedin' ? '' : res.subject || template.subject, body: String(res.body ?? '').trim(), ai: true });
      setOpen(true);
    } catch (error) {
      toast(error, 'error');
    } finally {
      setBusy(null);
    }
  };
  const person = target ?? reach;
  const assist = html`<div class="nm-assist">
    ${kind === 'prep' || kind === 'demo' ? html`
      <${AiButton} onClick=${() => setModal('brief')}>Prep brief<//>
      ${kind === 'demo' ? html`<${AiButton} onClick=${() => setModal('notes')}>Log it from my notes<//>`
        : template && html`<${AiButton} busy=${busy === 'email'} onClick=${() => write('email')}>Confirmation note<//>`}`
    : kind === 'reply' ? html`
      <${AiButton} busy=${busy === 'email'} onClick=${() => write('email')}>Draft my answer<//>
      <button type="button" class="btn small ghost" onClick=${() => setModal('reply')}>Paste their reply</button>`
    : template && html`
      <${AiButton} busy=${busy === 'email'} onClick=${() => write('email')}>Write it with AI<//>
      <${AiButton} busy=${busy === 'linkedin'} onClick=${() => write('linkedin')}>LinkedIn version<//>`}
    ${template && html`<button type="button" class="btn small ghost" onClick=${() => setOpen(!open)} aria-expanded=${open}>${open ? 'Hide message' : 'Show template'}</button>`}
  </div>`;
  return html`<div class="action-panel">
    ${action && html`<div class="nm-action">${action}${demo && (kind === 'prep' || kind === 'demo') && html` <span class=${`demo-date ${kind === 'demo' ? 'past' : ''}`}><${Icon} name="calendar" size=${14} /> ${dayLabel(demo.date, today)}</span>`}</div>`}
    ${showReach && reach && html`<div class="reach">
      <span class="reach-who"><strong>${nameOf(reach)}</strong>${reach.title ? html`<span class="muted"> · ${reach.title}</span>` : ''}${kind === 'intro' ? html`<span class="badge plain warm-badge">Your connection</span>` : ''}</span>
      <${ContactButtons} person=${reach} company=${company} draft=${draft} small />
    </div>`}
    ${kind !== 'research' && assist}
    ${open && draft && html`<${Draft} draft=${draft} onEdit=${(patch) => setEdits({ ...edits, ...patch })}
      label=${edits?.ai ? `Written by AI for ${nameOf(draft.to)}. Check it before sending.` : null}
      actions=${!showReach && html`<${ContactButtons} person=${reach} company=${company} draft=${draft} small />`} />`}
    <${OutcomeButtons} kind=${kind} company=${company} target=${target} connection=${connection} task=${task} demo=${demo} today=${today} onSaved=${onSaved}
      sent=${open && draft ? `${draft.subject ? `Subject: ${draft.subject}\n\n` : ''}${draft.body}` : null} />
    ${modal === 'brief' && html`<${BriefModal} company=${company} person=${person} demo=${demo} today=${today} onClose=${() => setModal(null)} />`}
    ${modal === 'reply' && html`<${ReplyModal} company=${company} person=${person} today=${today} onClose=${() => setModal(null)} onSaved=${() => { setModal(null); onSaved?.(); }} />`}
    ${modal === 'notes' && html`<${NotesModal} company=${company} person=${person} demo=${demo} task=${task} today=${today} onClose=${() => setModal(null)} onSaved=${() => { setModal(null); onSaved?.(); }} />`}
  </div>`;
}
