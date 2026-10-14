import { html, useState, useEffect, Modal, CompanyPicker, toast, changed, navigate } from '../lib/ui.js';
import { api } from '../lib/api.js';
import { ENTITIES, STAGES } from '../schema.js';

let open = () => {};
// Opens the create dialog for 'people', 'companies' or 'tasks', with optional defaults.
export const openNew = (kind, defaults = {}) => open({ kind, defaults });

const TITLES = { people: 'New person', companies: 'New company', tasks: 'New task' };

function PersonForm({ values, set }) {
  const relationship = ENTITIES.people.fields.find((f) => f.key === 'relationship');
  return html`<div class="form-grid">
    <label class="field"><span>First name *</span><input class="input" autofocus value=${values.first_name ?? ''} onInput=${(e) => set('first_name', e.target.value)} /></label>
    <label class="field"><span>Last name</span><input class="input" value=${values.last_name ?? ''} onInput=${(e) => set('last_name', e.target.value)} /></label>
    <label class="field"><span>Email</span><input class="input" type="email" value=${values.email ?? ''} onInput=${(e) => set('email', e.target.value)} /></label>
    <label class="field"><span>Title</span><input class="input" value=${values.title ?? ''} onInput=${(e) => set('title', e.target.value)} /></label>
    <div class="field full"><span class="small muted" style="font-weight:600">Company</span>
      <${CompanyPicker} value=${values.company_label ?? ''} onPick=${(c) => { set('company_id', c.id ?? ''); set('company_name', c.id ? '' : c.name); set('company_label', c.name); }} />
    </div>
    ${!values.company_id && html`<label class="field full"><span>Company website (optional)</span><input class="input" inputmode="url" placeholder="example.com" value=${values.company_website ?? ''} onInput=${(e) => set('company_website', e.target.value)} /></label>`}
    <label class="field"><span>LinkedIn URL</span><input class="input" inputmode="url" value=${values.linkedin_url ?? ''} onInput=${(e) => set('linkedin_url', e.target.value)} /></label>
    <label class="field"><span>Relationship</span><select class="input" value=${values.relationship ?? ''} onChange=${(e) => set('relationship', e.target.value)}>
      <option value="">—</option>${relationship.options.map((o) => html`<option value=${o}>${o}</option>`)}
    </select></label>
    <p class="full small muted" style="margin:0">With no company chosen, a business email address links or creates the company from its domain.</p>
  </div>`;
}

function CompanyForm({ values, set }) {
  return html`<div class="form-grid">
    <label class="field full"><span>Name *</span><input class="input" autofocus value=${values.name ?? ''} onInput=${(e) => set('name', e.target.value)} /></label>
    <label class="field"><span>Website</span><input class="input" inputmode="url" placeholder="example.com" value=${values.website ?? ''} onInput=${(e) => set('website', e.target.value)} /></label>
    <label class="field"><span>State</span><input class="input" value=${values.state ?? ''} onInput=${(e) => set('state', e.target.value)} /></label>
    <label class="field full"><span>Stage</span><select class="input" value=${values.stage ?? ''} onChange=${(e) => set('stage', e.target.value)}>
      <option value="">Not in pipeline</option>${STAGES.map((s) => html`<option value=${s.value}>${s.label}</option>`)}
    </select></label>
  </div>`;
}

function TaskForm({ values, set }) {
  return html`<div class="form-grid">
    <label class="field full"><span>Task *</span><input class="input" autofocus value=${values.title ?? ''} onInput=${(e) => set('title', e.target.value)} /></label>
    <label class="field"><span>Due date</span><input class="input" type="date" value=${values.due_date ?? ''} onInput=${(e) => set('due_date', e.target.value)} /></label>
    <div class="field"><span class="small muted" style="font-weight:600">Company (optional)</span>
      <${CompanyPicker} value=${values.company_label ?? ''} onPick=${async (c) => {
        try {
          const company = c.id ? c : await api.post('/api/companies', { name: c.name });
          set('company_id', company.id); set('company_label', company.name);
        } catch (error) { toast(error, 'error'); }
      }} />
    </div>
  </div>`;
}

export function QuickAdd() {
  const [state, setState] = useState(null);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { open = (s) => { setValues(s.defaults); setState(s); }; }, []);
  if (!state) return null;
  const close = () => setState(null);
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const submit = async (event) => {
    event?.preventDefault();
    setSaving(true);
    try {
      const { company_label, ...body } = values;
      if (state.kind === 'tasks') {
        await api.post('/api/tasks', body);
        toast('Task added');
        changed();
        close();
        return;
      }
      const record = await api.post(`/api/${state.kind}`, body);
      toast(`${state.kind === 'people' ? 'Person' : 'Company'} added`);
      changed();
      close();
      navigate(`/${state.kind}/${record.id}`);
    } catch (error) {
      toast(error, 'error');
    } finally {
      setSaving(false);
    }
  };
  const Form = { people: PersonForm, companies: CompanyForm, tasks: TaskForm }[state.kind];
  return html`<${Modal} title=${TITLES[state.kind]} onClose=${close} footer=${html`
    <button class="btn" onClick=${close}>Cancel</button>
    <button class="btn primary" disabled=${saving} onClick=${submit}>${saving ? 'Saving…' : 'Create'}</button>`}>
    <form onSubmit=${submit}><${Form} values=${values} set=${set} /><button type="submit" hidden /></form>
  <//>`;
}
