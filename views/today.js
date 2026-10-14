// Today: the command center for the 60-day plan. The demo goal and the pace it needs at the
// top, the one next move in the middle, the accounts closest to a demo and the AI tools
// beside it. Everything here exists to turn the pipeline into booked and held demos.
import { html, useState, useEffect, useApi, useChanged, Loading, ErrorBox, StageBadge, TierChip, Icon, Modal, ACTIVITY_ICONS, toast, fmtDate, fmtAgo, fmtCount, localDay, navigate } from '../lib/ui.js';
import { api } from '../lib/api.js';
import { STAGES, PLAN_LABELS, stageColor, personName } from '../schema.js';
import { ActionPanel, Snooze, refreshPlan, addDays, dayLabel } from '../lib/actions.js';
import { AiStatus, AiButton, aiCall, BriefModal, ReplyModal, NotesModal, BatchModal } from '../lib/ai.js';

// ---- Pace -------------------------------------------------------------------------------

// Compares progress with the share of the target that should be done by now.
function pace(actual, target, share) {
  if (!target) return null;
  if (actual >= target) return { status: 'good', label: 'Target met' };
  const expected = target * share;
  if (expected < 1 && actual === 0) return null; // too early to judge
  if (actual >= expected) return { status: 'good', label: 'On pace' };
  if (actual >= expected * 0.6) return { status: 'warning', label: 'Slightly behind' };
  return { status: 'serious', label: 'Behind' };
}

const Status = ({ p }) => p && html`<span class=${`viz-status ${p.status}`}>
  <span class="viz-status-icon" aria-hidden="true">${p.status === 'good' ? '✓' : '!'}</span>${p.label}</span>`;

const Meter = ({ value, max, label }) => html`<div class="viz-meter" role="meter" aria-label=${label} aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${value}>
  <div class="viz-meter-fill" style=${`width:${max ? Math.min(100, (value / max) * 100) : 0}%`} />
</div>`;

// Demos held and booked against the goal, and what it takes from here. The first demos take
// about two weeks to land after first touches, so the expected count ramps from day 15.
const RAMP_DAYS = 14;
function demoMath(data) {
  const { plan, progress, toDate, demos, funnel, untouched } = data;
  const goal = plan.goals.demos;
  const held = toDate.demos;
  const booked = demos.upcoming.length + demos.awaiting.length;
  const started = plan.saved && progress.started;
  const day = Math.max(0, Math.min(progress.day, plan.days));
  const expected = started ? goal * Math.max(0, (day - RAMP_DAYS) / Math.max(1, plan.days - RAMP_DAYS)) : 0;
  const projected = held + booked;
  let status = null;
  if (started) {
    if (projected >= goal) status = { status: 'good', label: 'Goal covered' };
    else if (projected >= expected) status = { status: 'good', label: 'On pace' };
    else if (projected >= expected * 0.75) status = { status: 'warning', label: 'Slightly behind' };
    else status = { status: 'serious', label: `Behind by ${Math.ceil(expected - projected)}` };
  }
  const daysLeft = started ? plan.days - day + 1 : plan.days;
  const weeks = Math.max(1, daysLeft / 7);
  const remaining = Math.max(0, goal - projected);
  const perWeek = remaining / weeks;
  // The plan's rates until 20 accounts have been started; after that, what has actually happened.
  const begun = funnel.cold + funnel.warm;
  const observed = begun >= 20 ? funnel.booked / begun : null;
  const coldRate = observed || plan.rates.cold / 100;
  return {
    goal, held, booked, expected, status, remaining, perWeek, weeks: Math.round(weeks),
    accounts: Math.ceil(perWeek / coldRate), intros: Math.ceil(perWeek / (plan.rates.warm / 100)),
    rateLabel: observed ? `your rate so far (${Math.round(observed * 100)}%)` : `the plan's ${plan.rates.cold}% assumption`,
    ready: untouched.ready, warm: untouched.warm,
  };
}

function GoalMeter({ m }) {
  const pct = (n) => `${Math.min(100, (n / Math.max(1, m.goal)) * 100)}%`;
  return html`<div class="goal-meter" role="meter" aria-label="Demos held and booked" aria-valuemin="0" aria-valuemax=${m.goal} aria-valuenow=${m.held}>
    <div class="gm-held" style=${`width:${pct(m.held)}`} />
    <div class="gm-booked" style=${`width:${pct(m.booked)}`} />
    ${m.expected > 0 && html`<span class="gm-pace" style=${`left:${pct(m.expected)}`} title=${`Pace: ${m.expected.toFixed(1)} by today`} />`}
  </div>`;
}

function DailyGoal({ data }) {
  const target = Math.max(1, Math.ceil(data.plan.weekly.touches / 5));
  const done = data.week.today;
  const pct = Math.min(100, Math.round((done / target) * 100));
  return html`<div class=${`daily-goal ${done >= target ? 'met' : ''}`} title="Touches logged today against your daily share of the weekly target">
    <div class="ring" style=${`--pct:${pct}`}><span>${done}</span></div>
    <div><div class="dg-value">${done >= target ? 'Daily goal met' : `${target - done} to go today`}</div>
      <div class="small muted">${done} of ${target} touches</div></div>
  </div>`;
}

function Mission({ data, onPlan }) {
  const { plan, progress, week, today } = data;
  const m = demoMath(data);
  const end = plan.start ? addDays(plan.start, plan.days - 1) : null;
  const when = !plan.saved ? html`<button class="link-button" onClick=${onPlan}>Set your start date and goal</button>`
    : !progress.started ? `Starts ${fmtDate(plan.start)} · ${1 - progress.day} days to line up buyers and intros`
      : progress.day > plan.days ? `Plan ended ${fmtDate(end)}`
        : `Day ${progress.day} of ${plan.days} · ends ${fmtDate(end)}`;
  const share = progress.weekday / 5;
  const weekRows = [['booked', 'Demos booked'], ['touches', 'Touches'], ['intros', 'Intro requests']];
  return html`<section class="card mission">
    <div class="m-goal">
      <div class="m-label"><${Icon} name="target" size=${15} /> ${m.goal} demos in ${plan.days} days <${Status} p=${m.status} /></div>
      <div class="m-big"><strong>${m.held}</strong><span>held</span>
        ${m.booked > 0 && html`<span class="m-booked">+ ${m.booked} booked</span>`}
        <span class="m-of">of ${m.goal}</span></div>
      <${GoalMeter} m=${m} />
      <div class="small muted">${when}</div>
    </div>
    <div class="m-week">
      <div class="m-label">This week</div>
      ${weekRows.map(([k, label]) => {
        const p = progress.started && plan.saved ? pace(week[k], plan.weekly[k], share) : null;
        return html`<div class="m-row" key=${k}>
          <span class="grow">${label}</span><strong>${fmtCount(week[k])}</strong><span class="muted small">/ ${fmtCount(plan.weekly[k])}</span>
          ${p && html`<span class=${`ws-dot ${p.status}`} role="img" aria-label=${p.label}>${p.status === 'good' ? '✓' : '!'}</span>`}
          <${Meter} value=${week[k]} max=${plan.weekly[k]} label=${label} />
        </div>`;
      })}
    </div>
    <${DailyGoal} data=${data} />
    <p class="m-need">${m.remaining === 0
      ? 'Demos held and booked cover the goal. Keep first touches going so the next stretch is full too.'
      : html`<strong>${m.perWeek < 10 ? m.perWeek.toFixed(1) : Math.round(m.perWeek)} demos a week</strong> for ${m.weeks} weeks gets you to ${m.goal}.
        At ${m.rateLabel} that is about <strong>${m.accounts} new accounts a week</strong>, or ${m.intros} intro requests.
        <span class="muted">Ready now: ${fmtCount(m.ready)} untouched accounts with a buyer, ${fmtCount(m.warm)} with a warm path.</span>`}</p>
  </section>`;
}

// ---- The next-move card -------------------------------------------------------------------

const KIND_TAGS = { demo: ['Demo needs an outcome', 'past'], prep: ['Demo coming up', 'soon'], reply: ['Reply waiting', 'reply'] };

function NextMove({ data, index, setIndex, reload }) {
  const queue = data.focus;
  const item = queue[index];
  const [details, setDetails] = useState(false);
  useEffect(() => setDetails(false), [item?.id]);
  const go = (step) => setIndex((i) => (i + step + queue.length) % queue.length);
  if (!item) {
    return html`<section class="card next-move empty-move">
      <div class="nm-label">Your next move</div>
      <h2>Your pipeline is empty</h2>
      <p class="muted">Add your best-fit target accounts and this page will line up the first touches.</p>
      <div class="nm-outcomes"><a class="btn primary" href="#/companies?view=targets">Add target accounts</a></div>
    </section>`;
  }
  const meta = [item.segment, item.city, item.fit != null ? `Fit ${item.fit}` : ''].filter(Boolean).join(' · ');
  const reasons = item.reasons.filter((r) => r.kind !== 'none' && r.kind !== 'demo' && r.kind !== 'reply').map((r) => r.text).join(' · ');
  const company = { id: item.id, name: item.name, stage: item.stage, segment: item.segment };
  const tag = KIND_TAGS[item.kind];
  return html`<section class="card next-move" aria-live="polite">
    <div class="nm-top">
      <span class="nm-label">Your next move</span>
      ${tag && html`<span class=${`kind-tag ${tag[1]}`}>${tag[0]}</span>`}
      <span class="spacer" />
      <span class="small muted">${index + 1} of ${queue.length}</span>
      <button class="btn ghost small icon" onClick=${() => go(-1)} aria-label="Previous account"><${Icon} name="back" size=${16} /></button>
      <button class="btn ghost small icon" onClick=${() => go(1)} aria-label="Next account"><${Icon} name="arrowRight" size=${16} /></button>
    </div>
    <div class="nm-account">
      <${TierChip} tier=${item.tier} />
      <a class="nm-name" href=${`#/companies/${item.id}`}>${item.name}</a>
      <${StageBadge} stage=${item.stage} />
      ${meta && html`<span class="small muted">${meta}</span>`}
    </div>
    <${ActionPanel} key=${item.id} kind=${item.kind} action=${item.action} company=${company} target=${item.target}
      connection=${item.connections[0] ?? null} task=${item.task} demo=${item.demo} outbound=${item.outbound}
      today=${data.today} me=${data.plan.name} onSaved=${reload} />
    <div class="nm-secondary">
      ${reasons && html`<span class="small muted grow">Why now: ${reasons}</span>`}
      ${(item.why || item.offer) && html`<button class="btn ghost small" onClick=${() => setDetails(!details)} aria-expanded=${details}>${details ? 'Hide' : 'Talking points'}</button>`}
      <${Snooze} company=${company} title=${item.action} today=${data.today} onDone=${reload} />
      <button class="btn ghost" onClick=${() => go(1)}>Skip</button>
    </div>
    ${details && html`<div class="nm-details">
      ${item.why && html`<p><strong>Why them:</strong> ${item.why}</p>`}
      ${item.offer && html`<p><strong>What to pitch:</strong> ${item.offer}</p>`}
      ${item.buyers.length > 0 && html`<p><strong>Buyers:</strong> ${item.buyers.map((b, i) => html`${i ? ' · ' : ''}<a href=${`#/people/${b.id}`}>${b.name}</a>${b.title ? `, ${b.title}` : ''}`)}</p>`}
    </div>`}
  </section>`;
}

function UpNext({ data, index, setIndex }) {
  const [all, setAll] = useState(false);
  const rest = data.focus.map((f, i) => ({ ...f, i })).filter((f) => f.i !== index);
  if (!rest.length) return null;
  const shown = all ? rest : rest.slice(0, 6);
  return html`<div class="up-next">
    <span class="small muted">Up next</span>
    ${shown.map((f) => html`<button class=${`chip ${KIND_TAGS[f.kind] ? `hot ${KIND_TAGS[f.kind][1]}` : ''}`} key=${f.id} onClick=${() => setIndex(f.i)}>
      <${TierChip} tier=${f.tier} /> ${f.name}</button>`)}
    ${rest.length > shown.length && html`<button class="btn ghost small" onClick=${() => setAll(true)}>+${rest.length - shown.length} more</button>`}
  </div>`;
}

// ---- Closest to a demo ------------------------------------------------------------------------

function DemoBoard({ data, select, openTool }) {
  const { demos, focus, today } = data;
  const [brief, setBrief] = useState(null);
  const replies = focus.filter((f) => f.kind === 'reply');
  const groups = [
    ['Did these happen?', demos.awaiting.map((d) => ({ key: d.id, id: d.company_id, tier: d.tier, name: d.company_name, tone: 'past',
      sub: `Demo ${dayLabel(d.date, today)}${d.person ? ` with ${d.person.name}` : ''}` }))],
    ['Replies waiting on you', replies.map((f) => ({ key: f.id, id: f.id, tier: f.tier, name: f.name, tone: 'reply',
      sub: `${f.target?.name ?? 'Buyer'} replied${f.reply ? ` ${fmtAgo(f.reply.at)}` : ''}` }))],
    ['Demos coming up', demos.upcoming.map((d) => ({ key: d.id, id: d.company_id, tier: d.tier, name: d.company_name, tone: 'soon', demo: d,
      sub: `${dayLabel(d.date, today)}${d.person ? ` with ${d.person.name}` : ''}` }))],
  ].filter(([, rows]) => rows.length);
  return html`<section class="card demo-board">
    <div class="head"><h2 class="grow">Closest to a demo</h2><span class="small muted">${demos.upcoming.length} on the calendar</span></div>
    ${groups.length ? html`<div class="body flush">${groups.map(([title, rows]) => html`
      <div class="group-label">${title}</div>
      <ul class="items">${rows.map((r) => html`<li key=${r.key} class=${`hot-row ${r.tone}`}>
        <button class="hot-main" onClick=${() => select(r.id)}><${TierChip} tier=${r.tier} />
          <span class="grow"><span class="title ellipsis">${r.name}</span><span class="meta">${r.sub}</span></span></button>
        ${r.demo && html`<${AiButton} onClick=${() => setBrief(r.demo)}>Prep<//>`}
      </li>`)}</ul>`)}</div>`
      : html`<div class="body demo-empty">
        <p>No replies or demos yet. Every demo starts as a first touch, and ${fmtCount(data.untouched.ready)} accounts are ready for one.</p>
        <${AiButton} primary onClick=${() => openTool('batch')}>Draft my next 5 messages<//>
      </div>`}
    ${brief && html`<${BriefModal} company=${{ id: brief.company_id, name: brief.company_name }} person=${brief.person} demo=${brief} today=${today} onClose=${() => setBrief(null)} />`}
  </section>`;
}

// ---- AI tools ----------------------------------------------------------------------------------

const TOOLS = [
  ['batch', 'Draft my next 5 messages', 'First touches, follow-ups and intro asks from your queue, ready to review and send'],
  ['reply', 'Read a reply', 'Paste what they wrote; get an answer that offers demo times and the log entry'],
  ['notes', 'Log from my notes', 'Rough call or meeting notes become a log entry, a next step and account facts'],
  ['update', 'Weekly update', 'A short note for your manager from this week’s numbers'],
];

function AiTools({ openTool }) {
  return html`<section class="card ai-tools">
    <div class="head"><h2 class="grow">AI assist</h2><${AiStatus} /></div>
    <ul class="tool-list">${TOOLS.map(([k, title, sub]) => html`<li key=${k}>
      <button onClick=${() => openTool(k)}><span class="tool-icon"><${Icon} name="spark" size=${16} /></span>
        <span class="grow"><strong>${title}</strong><span class="small muted">${sub}</span></span><${Icon} name="arrowRight" size=${15} /></button>
    </li>`)}</ul>
    <div class="small muted ai-note">Scripted fictional examples. No live AI requests or messages are sent by this demo.</div>
  </section>`;
}

// ---- Plan and weekly review -------------------------------------------------------------------

export function PlanEditor({ plan, onClose, onSaved }) {
  const [v, setV] = useState({ start: plan.start ?? localDay(), days: plan.days, name: plan.name ?? '', weekly: { ...plan.weekly }, goals: { ...plan.goals }, rates: { ...plan.rates } });
  const [saving, setSaving] = useState(false);
  const num = (group, key) => (e) => setV({ ...v, [group]: { ...v[group], [key]: e.target.value } });
  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      refreshPlan(await api.put('/api/plan', v));
      toast('Plan saved');
      onSaved();
    } catch (error) {
      toast(error, 'error');
      setSaving(false);
    }
  };
  const group = (key, title) => html`<h3 class="section-title">${title}</h3>
    <div class="form-grid">${Object.entries(PLAN_LABELS[key]).map(([k, label]) => html`
      <label class="field"><span>${label}</span><input class="input" type="number" min="0" value=${v[key][k]} onInput=${num(key, k)} /></label>`)}</div>`;
  return html`<${Modal} title="Your 60-day plan" onClose=${onClose} footer=${html`
    <button class="btn" onClick=${onClose}>Cancel</button>
    <button class="btn primary" disabled=${saving} onClick=${save}>${saving ? 'Saving…' : 'Save plan'}</button>`}>
    <form class="stack" onSubmit=${save}>
      <p class="small muted" style="margin:0">Use the numbers you agree with your manager. Weekly targets reset every Monday; goals count from the start date.</p>
      <div class="form-grid">
        <label class="field"><span>Start date</span><input class="input" type="date" value=${v.start} onInput=${(e) => setV({ ...v, start: e.target.value })} /></label>
        <label class="field"><span>Length (days)</span><input class="input" type="number" min="1" value=${v.days} onInput=${(e) => setV({ ...v, days: e.target.value })} /></label>
        <label class="field full"><span>Your name (signs message drafts)</span><input class="input" value=${v.name} onInput=${(e) => setV({ ...v, name: e.target.value })} /></label>
      </div>
      ${group('goals', 'By the end of the plan')}
      ${group('weekly', 'Every week')}
      ${group('rates', 'Planning assumptions')}
      <p class="small muted" style="margin:0">Today uses these rates to turn the demos you still need into accounts to start each week. After 20 accounts it uses your actual rate instead.</p>
      <button type="submit" hidden />
    </form>
  <//>`;
}

function summaryText(data) {
  const { plan, progress, week, toDate, demos } = data;
  const m = demoMath(data);
  return [
    `Week of ${fmtDate(progress.weekStart, { year: true })}${progress.started ? ` (day ${progress.day} of ${plan.days})` : ''}`,
    `- Demo goal: ${toDate.demos} held and ${m.booked} booked of ${plan.goals.demos}${m.status ? ` (${m.status.label.toLowerCase()})` : ''}`,
    ...Object.entries(PLAN_LABELS.weekly).map(([k, label]) => `- ${label} this week: ${week[k]} of ${plan.weekly[k]}`),
    `- Demos held this week: ${week.demos}`,
    demos.upcoming.length ? `- Coming up: ${demos.upcoming.map((d) => `${d.company_name} ${fmtDate(d.date)}`).join(', ')}` : '- No demos on the calendar yet',
    `Since ${fmtDate(plan.start ?? data.today, { year: true })}: ${Object.entries(PLAN_LABELS.goals).map(([k, label]) => `${label.toLowerCase()} ${toDate[k]} of ${plan.goals[k]}`).join('; ')}`,
    `Pipeline: ${STAGES.filter((s) => data.stages[s.value]).map((s) => `${s.label} ${data.stages[s.value]}`).join(', ') || 'empty'}`,
    `Focus next: ${data.focus.slice(0, 5).map((f) => f.name).join(', ') || 'none'}`,
  ].join('\n');
}

function WeeklyReview({ data, onClose }) {
  const { plan, progress, toDate } = data;
  const share = Math.min(1, Math.max(0, progress.day / plan.days));
  const [text, setText] = useState(() => summaryText(data));
  const [busy, setBusy] = useState(false);
  const write = async () => {
    setBusy(true);
    try { setText(String((await aiCall('update', { facts: summaryText(data) })).text ?? '').trim()); } catch (error) { toast(error, 'error'); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Summary copied'); } catch { toast('Copy failed; select the text and copy it', 'error'); }
  };
  return html`<${Modal} title="Weekly review" wide onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <div class="row wrap"><h3 class="section-title grow">Update for your manager</h3>
      <${AiButton} busy=${busy} onClick=${write}>Write it with AI<//>
      <button class="btn small" onClick=${copy}>Copy</button></div>
    <textarea class="input summary-text" rows=${Math.max(8, text.split('\n').length + 1)} value=${text} onInput=${(e) => setText(e.target.value)} />
    <div class="review-grid" style="margin-top:16px">
      <section>
        <h3 class="section-title">${plan.days}-day goals</h3>
        <p class="small muted" style="margin:2px 0 10px">${progress.started ? `Since ${fmtDate(plan.start ?? data.today, { year: true })} · ${Math.round(share * 100)}% of the time used` : `Starts ${fmtDate(plan.start, { year: true })}`}</p>
        <div class="stack">${Object.entries(PLAN_LABELS.goals).map(([k, label]) => html`<div key=${k}>
          <div class="row"><span class="grow">${label}</span><strong>${fmtCount(toDate[k])}</strong><span class="muted small">of ${fmtCount(plan.goals[k])}</span></div>
          <${Meter} value=${toDate[k]} max=${plan.goals[k]} label=${label} />
        </div>`)}</div>
      </section>
      <section>
        <h3 class="section-title">Pipeline</h3>
        <ul class="items stage-counts">${STAGES.filter((s) => data.stages[s.value]).map((s) => html`<li key=${s.value}>
          <span class="stage-dot" style=${`background:${stageColor(s.value)}`} />
          <a class="grow" href=${`#/companies?view=pipeline&stage=${s.value}`} onClick=${onClose}>${s.label}</a><strong>${fmtCount(data.stages[s.value])}</strong>
        </li>`)}</ul>
        ${!Object.keys(data.stages).length && html`<p class="small muted">No accounts in the pipeline.</p>`}
      </section>
    </div>
    <h3 class="section-title" style="margin-top:16px">Recent touches</h3>
    ${data.recent.length ? html`<ul class="items">${data.recent.map((a) => html`<li key=${a.id}>
      <span class="faint"><${Icon} name=${ACTIVITY_ICONS[a.type] ?? 'note'} size=${16} /></span>
      <div class="grow"><div class="title ellipsis">${a.summary || a.body}</div>
        <div class="meta">${a.type}${a.channel ? ` · ${a.channel}` : ''}${a.company_name ? ` · ${a.company_name}` : ''}${a.person_id ? ` · ${personName(a)}` : ''}</div></div>
      <span class="due">${fmtAgo(a.at)}</span>
    </li>`)}</ul>` : html`<p class="small muted">No touches logged yet.</p>`}
  <//>`;
}

// ---- Page ------------------------------------------------------------------------------------

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function Today() {
  const { data, error, reload } = useApi(`/api/today?today=${localDay()}&tz=${new Date().getTimezoneOffset()}`);
  useChanged(reload);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState(null);
  // Keep the position when a logged account drops out of the queue.
  useEffect(() => {
    if (data && index >= data.focus.length) setIndex(Math.max(0, data.focus.length - 1));
  }, [data]);
  if (error) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const { plan } = data;
  const date = new Date(`${data.today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  // Rail rows open their account in the next-move card, or its page when it is not in the queue.
  const select = (id) => {
    const i = data.focus.findIndex((f) => f.id === id);
    if (i < 0) return navigate(`/companies/${id}`);
    setIndex(i);
    scrollTo({ top: 0, behavior: 'smooth' });
  };
  const batch = data.focus.filter((f) => ['outreach', 'follow', 'intro', 'task'].includes(f.kind) && (f.kind === 'intro' ? f.connections[0] : f.target)).slice(0, 5);
  const close = () => setTool(null);
  const saved = () => { setTool(null); reload(); };
  return html`<div class="today">
    <div class="today-top">
      <div class="grow"><h1>${greeting()}${plan.name ? `, ${plan.name.split(' ')[0]}` : ''}</h1><div class="sub muted">${date}</div></div>
      <button class="btn ghost small" onClick=${() => setEditing(true)}><${Icon} name="settings" size=${15} /> ${plan.saved ? 'Plan' : 'Set up your plan'}</button>
    </div>
    <${Mission} data=${data} onPlan=${() => setEditing(true)} />
    <div class="cc-grid">
      <div class="cc-main">
        <${NextMove} data=${data} index=${Math.min(index, Math.max(0, data.focus.length - 1))} setIndex=${setIndex} reload=${reload} />
        <${UpNext} data=${data} index=${index} setIndex=${setIndex} />
      </div>
      <aside class="cc-rail">
        <${DemoBoard} data=${data} select=${select} openTool=${setTool} />
        <${AiTools} openTool=${setTool} />
      </aside>
    </div>
    ${editing && html`<${PlanEditor} plan=${plan} onClose=${() => setEditing(false)} onSaved=${() => { setEditing(false); reload(); }} />`}
    ${tool === 'batch' && (batch.length ? html`<${BatchModal} items=${batch} today=${data.today} onClose=${() => { close(); reload(); }} />`
      : html`<${Modal} title="Draft my next messages" onClose=${close}><p>Nothing in your queue needs a message right now. Add buyers to your pipeline accounts, or add more target accounts.</p><//>`)}
    ${tool === 'reply' && html`<${ReplyModal} today=${data.today} onClose=${close} onSaved=${saved} />`}
    ${tool === 'notes' && html`<${NotesModal} today=${data.today} onClose=${close} onSaved=${saved} />`}
    ${tool === 'update' && html`<${WeeklyReview} data=${data} onClose=${close} />`}
  </div>`;
}
