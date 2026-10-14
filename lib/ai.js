// AI assist in the browser. The model runs on the CRM's own server (see lib/ai.mjs); the
// browser sends record ids and pasted text, never prompts. This file has the status pill,
// the AI button, and the modals that use it: demo prep briefs, reading a pasted reply,
// turning notes into a log entry, and drafting a batch of messages.
import { html, useState, useEffect, useRef, Icon, Modal, TierChip, toast, changed, localDay, CompanyPicker } from './ui.js?v=ae938a762063';
import { api } from './api.js?v=ae938a762063';
import { personName } from '../schema.js?v=ae938a762063';
import { OutcomePanel, Draft, ContactButtons, OUTCOMES, businessDaysAfter, nameOf, saveOutcome, outcomeDefaults, rankBuyers, dayLabel } from './actions.js?v=ae938a762063';

export const aiCall = (task, body) => api.post(`/api/ai/${task}`, { today: localDay(), ...body });

const list = (x) => (Array.isArray(x) ? x.map(String) : x ? [String(x)] : []);
// Business days the model suggested for the next step, kept to 0-10; 0 means today.
const dueDays = (n, fallback) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? fallback : Math.min(10, Math.max(0, Math.round(Number(n)))));
const FIRST_RUN = 'Scripted demo samples load locally.';

// ---- Status -------------------------------------------------------------------------------

let status = null;
let checking = false;
const listeners = new Set();
const publish = (s) => { status = s; listeners.forEach((fn) => fn(s)); return s; };
const check = () => api.get('/api/ai/status').then(publish, () => publish({ enabled: false }));

// Checks the model once per page load and asks the server to load it if it is not in
// memory yet, so the first button press does not wait for it.
export function useAiStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    listeners.add(setS);
    if (!checking) {
      checking = true;
      (async () => {
        let st = await check();
        if (st.enabled && st.ready && !st.loaded) {
          api.post('/api/ai/warm').catch(() => {});
          for (let i = 0; i < 24 && !st.loaded; i++) {
            await new Promise((done) => setTimeout(done, 5000));
            st = await check();
          }
        }
        checking = false;
      })();
    }
    return () => listeners.delete(setS);
  }, []);
  return s;
}

export function AiStatus() {
  const s = useAiStatus();
  if (!s) return null;
  const [state, label] = !s.enabled ? ['off', 'AI off'] : !s.ready ? ['off', 'AI offline'] : !s.loaded ? ['warming', 'AI warming up'] : ['ready', 'Demo samples'];
  return html`<span class=${`ai-status ${state}`} title=${s.model ? `${s.model}; no live AI requests` : 'AI is not available'}><span class="dot" />${label}</span>`;
}

export function AiButton({ onClick, busy, primary, children }) {
  return html`<button type="button" class=${`btn small ai ${primary ? 'primary' : ''}`} onClick=${onClick} disabled=${busy}>
    <${Icon} name="spark" size=${14} /> ${busy ? 'Writing…' : children}</button>`;
}

// ---- Picking the account and person ----------------------------------------------------------

function useAccount(company, person) {
  const [account, setAccount] = useState(company?.id ? company : null);
  const [people, setPeople] = useState([]);
  const [who, setWho] = useState(person ?? null);
  useEffect(() => {
    if (!account?.id) return;
    api.get(`/api/companies/${account.id}`).then((d) => {
      setPeople(d.people.filter((p) => p.relationship === 'Buyer' || p.relationship === 'Connection'));
      if (!person) setWho(rankBuyers(d.people)[0] ?? null);
    }, () => {});
  }, [account?.id]);
  const picker = html`<div class="form-grid">
    <label class="field"><span>Account</span>${company?.id ? html`<div class="input static">${company.name}</div>`
      : html`<${CompanyPicker} value=${account?.name ?? ''} onPick=${setAccount} placeholder="Search accounts" allowCreate=${false} />`}</label>
    <label class="field"><span>From</span>
      <select class="input" value=${who?.id ?? ''} onChange=${(e) => setWho(people.find((p) => p.id === e.target.value) ?? null)} disabled=${!account}>
        ${!people.some((p) => p.id === who?.id) && html`<option value=${who?.id ?? ''}>${who ? nameOf(who) : 'Someone not on file'}</option>`}
        ${people.map((p) => html`<option value=${p.id}>${personName(p)}${p.title ? ` · ${p.title}` : ''}</option>`)}
      </select></label>
  </div>`;
  return { account, who, picker };
}

// ---- Demo prep brief ------------------------------------------------------------------------

export function BriefModal({ company, person, demo, today, onClose }) {
  const [brief, setBrief] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { aiCall('brief', { company_id: company.id, person_id: person?.id ?? null }).then(setBrief, setError); }, []);
  const sections = brief && [
    ['Leave the meeting with', list(brief.goals)], ['Questions to ask', list(brief.questions)],
    ['What to show', list(brief.show)], ['Signs it is not a fit', list(brief.risks)],
  ];
  const text = brief && [brief.summary, ...sections.flatMap(([title, items]) => ['', `${title}:`, ...items.map((i) => `- ${i}`)]), '', `Ask for: ${brief.ask}`].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('Brief copied'); } catch { toast('Select the text and copy it', 'error'); } };
  return html`<${Modal} title=${`Demo prep: ${company.name}`} wide onClose=${onClose} footer=${html`
    ${brief && html`<button class="btn" onClick=${copy}><${Icon} name="note" size=${15} /> Copy brief</button>`}
    <button class="btn primary" onClick=${onClose}>Done</button>`}>
    <p class="small muted" style="margin:0 0 10px">${person ? `With ${nameOf(person)}${person.title ? `, ${person.title}` : ''}` : ''}${demo ? ` · ${dayLabel(demo.date, today)}` : ''}</p>
    ${error ? html`<div class="ai-error">${error.message}</div>`
      : !brief ? html`<div class="ai-wait"><${Icon} name="spark" /> Writing the brief from this account's research and history… <div class="small muted">${FIRST_RUN}</div></div>`
      : html`<div class="brief">
        <p class="brief-summary">${brief.summary}</p>
        <div class="brief-grid">${sections.map(([title, items]) => items.length > 0 && html`<section><h3 class="section-title">${title}</h3><ul>${items.map((i) => html`<li>${i}</li>`)}</ul></section>`)}</div>
        ${brief.ask && html`<p class="brief-ask"><strong>Ask for:</strong> ${brief.ask}</p>`}
        <p class="small muted">Scripted fictional sample. No live AI model is connected.</p>
      </div>`}
  <//>`;
}

// ---- Reading a pasted reply ------------------------------------------------------------------

const INTENTS = { interested: 'Interested', question: 'Has a question', later: 'Not now', referral: 'Referred you', not_interested: 'Not interested', out_of_office: 'Out of office', unclear: 'Unclear' };

export function ReplyModal({ company, person, today, onClose, onSaved }) {
  const { account, who, picker } = useAccount(company, person);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [answer, setAnswer] = useState(null);
  const read = async () => {
    setBusy(true);
    try {
      const r = await aiCall('read-reply', { company_id: account.id, person_id: who?.id ?? null, text });
      setResult(r);
      setAnswer({ to: who ?? { name: 'them' }, subject: r.answer?.subject ?? '', body: String(r.answer?.body ?? '').trim() });
    } catch (error) {
      toast(error, 'error');
    } finally {
      setBusy(false);
    }
  };
  const [answered, setAnswered] = useState(true);
  const booked = result?.outcome === 'booked' && /^\d{4}-\d{2}-\d{2}$/.test(result.demo_date ?? '');
  const days = dueDays(result?.due_in_days, 1);
  // Their reply is logged by the panel; the answer you sent is logged after it, so the
  // account stops showing as a reply waiting on you.
  const saved = async () => {
    if (answered && answer?.body.trim()) {
      try {
        await api.post('/api/activities', { company_id: account.id, person_id: who?.id ?? null, type: 'Outreach', channel: 'Email',
          summary: `Answered ${who ? nameOf(who) : 'their reply'}`, body: answer.body });
        changed();
      } catch (error) { toast(error, 'error'); }
    }
    onSaved?.();
  };
  return html`<${Modal} title="Read a reply" wide onClose=${onClose}>
    <div class="stack">
      ${picker}
      <label class="field"><span>Their reply (paste the email or message)</span>
        <textarea class="input" rows=${result ? 4 : 8} value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Paste what they wrote" /></label>
      <div class="row"><${AiButton} primary busy=${busy} onClick=${read}>${result ? 'Read it again' : 'Read it and draft my answer'}<//>
        ${!account && html`<span class="small muted">Choose the account first.</span>`}</div>
      ${result && html`
        <div class="ai-read"><span class=${`intent i-${result.intent}`}>${INTENTS[result.intent] ?? 'Reply'}</span> ${result.summary}</div>
        <${Draft} draft=${answer} onEdit=${(patch) => setAnswer({ ...answer, ...patch })} label="Your answer, written by AI. Check it before sending."
          actions=${who && html`<${ContactButtons} person=${who} company=${account} draft=${answer} small />`} />
        <h3 class="section-title">Log it</h3>
        <label class="row small"><input type="checkbox" checked=${answered} onChange=${(e) => setAnswered(e.target.checked)} /> I sent my answer; log it too</label>
        <${OutcomePanel} key=${JSON.stringify(result)} company=${account} target=${who} connection=${null} task=${null} today=${today}
          outcome=${booked ? 'booked' : 'reply'}
          initial=${{ summary: result.summary, body: text, next: result.next_step, due: booked ? result.demo_date : businessDaysAfter(today, days),
            stage: result.outcome === 'decline' || result.intent === 'not_interested' ? 'nurture' : undefined }}
          onSaved=${saved} />`}
    </div>
  <//>`;
}

// ---- Turning notes into a log entry -------------------------------------------------------------

// actions.js and this file import each other, so OUTCOMES is read at render time, not load time.
const loggable = (k) => !!OUTCOMES[k] && !OUTCOMES[k].change && k !== 'intro' && k !== 'introMade';

export function NotesModal({ company, person, demo, task, today, onClose, onSaved }) {
  const { account, who, picker } = useAccount(company, person);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [keep, setKeep] = useState({ pain: true, decision: true });
  const run = async () => {
    setBusy(true);
    try {
      setResult(await aiCall('notes', { company_id: account.id, person_id: who?.id ?? null, text }));
    } catch (error) {
      toast(error, 'error');
    } finally {
      setBusy(false);
    }
  };
  let outcome = loggable(result?.outcome) ? result.outcome : 'note';
  if (outcome === 'booked' && !/^\d{4}-\d{2}-\d{2}$/.test(result?.demo_date ?? '')) outcome = 'reply';
  const days = dueDays(result?.due_in_days, 2);
  const details = String(result?.details ?? '').trim();
  // Facts worth keeping on the account record, appended to anything already there.
  const facts = [['pain', 'buyer_pain', 'Buyer-confirmed pain'], ['decision', 'decision_path', 'Decision path']].filter(([k]) => String(result?.[k] ?? '').trim());
  const saved = async () => {
    const patch = {};
    for (const [k, key] of facts) if (keep[k]) patch[key] = [account[key], result[k].trim()].filter(Boolean).join('\n');
    try { if (Object.keys(patch).length && account.id) await api.patch(`/api/companies/${account.id}`, patch); } catch (error) { toast(error, 'error'); }
    changed();
    onSaved?.();
  };
  return html`<${Modal} title="Log from my notes" wide onClose=${onClose}>
    <div class="stack">
      ${picker}
      <label class="field"><span>Your notes (rough is fine)</span>
        <textarea class="input" rows=${result ? 4 : 8} value=${text} onInput=${(e) => setText(e.target.value)} placeholder="What happened, what they said, what's next" /></label>
      <div class="row"><${AiButton} primary busy=${busy} onClick=${run}>${result ? 'Read them again' : 'Turn into a log entry'}<//>
        ${!account && html`<span class="small muted">Choose the account first.</span>`}</div>
      ${result && html`
        ${facts.length > 0 && html`<div class="ai-facts">${facts.map(([k, , label]) => html`<label class="row small"><input type="checkbox" checked=${keep[k]} onChange=${(e) => setKeep({ ...keep, [k]: e.target.checked })} />
          Save to the account's ${label.toLowerCase()}: <em>${result[k]}</em></label>`)}</div>`}
        <${OutcomePanel} key=${JSON.stringify(result)} company=${account} target=${who} connection=${null} task=${task ?? null} demo=${demo} today=${today}
          outcome=${outcome}
          initial=${{ summary: result.summary, body: details ? `${details}\n\nNotes:\n${text}` : text, next: result.next_step ?? '',
            due: outcome === 'booked' ? result.demo_date : businessDaysAfter(today, days) }}
          onSaved=${saved} />`}
    </div>
  <//>`;
}

// ---- A batch of drafts -------------------------------------------------------------------------

// Drafts the next few messages in one go (the model writes them one after another), so a
// block of outreach is review, send, mark sent.
export function BatchModal({ items, today, onClose }) {
  const [channel, setChannel] = useState('email');
  const [rows, setRows] = useState([]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const update = (i, patch) => alive.current && setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  useEffect(() => {
    const fresh = items.map((it) => ({ it, state: 'waiting' }));
    setRows(fresh);
    let stop = false;
    (async () => {
      for (let i = 0; i < fresh.length && !stop && alive.current; i++) {
        const { it } = fresh[i];
        update(i, { state: 'writing' });
        try {
          const res = await aiCall('draft', { company_id: it.id, person_id: it.target?.id ?? null, connection_id: it.kind === 'intro' ? it.connections[0]?.id : null,
            kind: it.kind, channel, touch: (it.outbound ?? 0) + 1 });
          if (!stop) update(i, { state: 'ready', draft: { to: it.kind === 'intro' ? it.connections[0] : it.target, subject: channel === 'linkedin' ? '' : res.subject ?? '', body: String(res.body ?? '').trim() } });
        } catch (error) {
          if (!stop) update(i, { state: 'error', error: error.message });
        }
      }
    })();
    return () => { stop = true; };
  }, [channel]);
  const sent = async (i) => {
    const { it, draft } = rows[i];
    const company = { id: it.id, name: it.name, stage: it.stage, segment: it.segment };
    const body = `${draft.subject ? `Subject: ${draft.subject}\n\n` : ''}${draft.body}`;
    const connection = it.connections[0] ?? null;
    const outcome = it.kind === 'intro' ? 'intro' : channel === 'linkedin' ? 'linkedin' : 'email';
    const task = it.kind === 'task' ? it.task : null;
    try {
      await saveOutcome({ outcome, company, target: it.target, connection, task, v: { ...outcomeDefaults({ outcome, company, target: it.target, connection, task, today }), body } });
      update(i, { state: 'logged' });
    } catch (error) { toast(error, 'error'); }
  };
  const done = rows.filter((r) => r.state === 'ready' || r.state === 'logged').length;
  return html`<${Modal} title="Draft my next messages" wide onClose=${onClose} footer=${html`<button class="btn primary" onClick=${onClose}>Done</button>`}>
    <div class="row wrap" style="margin-bottom:12px">
      <span class="small muted grow">${done} of ${rows.length} written. Review each one, send it, then mark it sent to log the touch and set the follow-up.</span>
      <div class="seg" role="group" aria-label="Channel">
        ${[['email', 'Email'], ['linkedin', 'LinkedIn']].map(([k, label]) => html`<button type="button" class=${channel === k ? 'on' : ''} onClick=${() => setChannel(k)}>${label}</button>`)}
      </div>
    </div>
    <div class="batch">${rows.map((r, i) => html`<section class=${`batch-row ${r.state}`} key=${r.it.id}>
      <div class="row wrap"><${TierChip} tier=${r.it.tier} /><a class="grow" href=${`#/companies/${r.it.id}`} onClick=${onClose}><strong>${r.it.name}</strong></a>
        <span class="small muted">${r.it.action}</span></div>
      ${r.state === 'waiting' && html`<div class="small muted">Waiting…</div>`}
      ${r.state === 'writing' && html`<div class="ai-wait small"><${Icon} name="spark" size=${14} /> Writing…</div>`}
      ${r.state === 'error' && html`<div class="ai-error small">${r.error}</div>`}
      ${(r.state === 'ready' || r.state === 'logged') && html`
        <${Draft} draft=${r.draft} onEdit=${(patch) => update(i, { draft: { ...r.draft, ...patch } })} label=${`To ${nameOf(r.draft.to)}`}
          actions=${html`<${ContactButtons} person=${r.draft.to} company=${{ name: r.it.name }} draft=${r.draft} small />`} />
        <div class="row">${r.state === 'logged' ? html`<span class="logged-note"><${Icon} name="check" size=${15} /> Logged, follow-up set</span>`
          : html`<button class="btn small primary" onClick=${() => sent(i)}><${Icon} name="check" size=${14} /> Mark sent</button>`}</div>`}
    </section>`)}</div>
  <//>`;
}
