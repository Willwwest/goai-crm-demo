import { resetDemo } from './lib/demo-api.mjs';
import { html, render, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { useRoute, Icon, Toasts, StageBadge, navigate } from './lib/ui.js';
import { api } from './lib/api.js';
import { BRAND, personName } from './schema.js';
import { Today } from './views/today.js';
import { Pipeline } from './views/pipeline.js';
import { RecordList } from './views/list.js';
import { RecordPage } from './views/record.js';
import { Tasks } from './views/tasks.js';
import { Settings } from './views/settings.js';
import { Insights } from './views/insights.js';
import { QuickAdd, openNew } from './views/quickadd.js';

const NAV = [
  ['', 'Today', 'home'],
  ['pipeline', 'Pipeline', 'board'],
  ['companies', 'Companies', 'building'],
  ['people', 'People', 'users'],
  ['tasks', 'Tasks', 'checkSquare'],
  ['insights', 'Insights', 'chart'],
];

function GlobalSearch() {
  const [text, setText] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    if (!text.trim()) { setResults(null); return; }
    const timer = setTimeout(() => api.get(`/api/search?q=${encodeURIComponent(text)}`).then((r) => { setResults(r); setFocus(0); }, () => {}), 160);
    return () => clearTimeout(timer);
  }, [text]);
  const items = results ? [
    ...results.companies.map((c) => ({ href: `/companies/${c.id}`, label: c.name, extra: c.stage && html`<${StageBadge} stage=${c.stage} />`, icon: 'building' })),
    ...results.people.map((p) => ({ href: `/people/${p.id}`, label: personName(p), extra: html`<span class="small muted ellipsis">${p.company_name ?? ''}</span>`, icon: 'users' })),
  ] : [];
  const go = (item) => { navigate(item.href); setText(''); setOpen(false); input.current?.blur(); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => Math.min(f + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => Math.max(f - 1, 0)); }
    else if (e.key === 'Enter' && items[focus]) go(items[focus]);
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  };
  const companyCount = results?.companies.length ?? 0;
  return html`<div class="search">
    <${Icon} name="search" size=${16} />
    <input ref=${input} class="input" type="search" placeholder="Search companies and people" value=${text}
      onInput=${(e) => { setText(e.target.value); setOpen(true); }} onFocus=${() => setOpen(true)}
      onBlur=${() => setTimeout(() => setOpen(false), 150)} onKeyDown=${onKeyDown} aria-label="Search" />
    ${open && results && html`<div class="search-results">
      ${!items.length && html`<div class="empty">No matches</div>`}
      ${items.map((item, i) => html`
        ${i === 0 && companyCount > 0 && html`<div class="group">Companies</div>`}
        ${i === companyCount && html`<div class="group">People</div>`}
        <a href=${`#${item.href}`} class=${i === focus ? 'focus' : ''} onMouseDown=${(e) => { e.preventDefault(); go(item); }}>
          <span class="faint"><${Icon} name=${item.icon} size=${15} /></span><span class="grow ellipsis">${item.label}</span>${item.extra}
        </a>`)}
    </div>`}
  </div>`;
}

function NewMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    setTimeout(() => addEventListener('click', close), 0);
    return () => removeEventListener('click', close);
  }, [open]);
  const pick = (kind) => { setOpen(false); openNew(kind); };
  return html`<div style="position:relative">
    <button class="btn primary" onClick=${() => setOpen(!open)} aria-haspopup="menu" aria-expanded=${open}><${Icon} name="plus" size=${16} /><span class="new-label">New</span></button>
    ${open && html`<div class="menu" role="menu">
      <button role="menuitem" onClick=${() => pick('people')}><${Icon} name="users" size=${16} /> Person</button>
      <button role="menuitem" onClick=${() => pick('companies')}><${Icon} name="building" size=${16} /> Company</button>
      <button role="menuitem" onClick=${() => pick('tasks')}><${Icon} name="checkSquare" size=${16} /> Task</button>
    </div>`}
  </div>`;
}

function App() {
  const { parts, query } = useRoute();
  const [section = '', id] = parts;
  useEffect(() => { scrollTo(0, 0); }, [section, id]);
  let page;
  if (section === '') page = html`<${Today} />`;
  else if (section === 'pipeline') page = html`<${Pipeline} />`;
  else if ((section === 'companies' || section === 'people') && id) page = html`<${RecordPage} key=${id} kind=${section} id=${id} />`;
  else if (section === 'companies' || section === 'people') page = html`<${RecordList} key=${`${section}?${new URLSearchParams(query)}`} kind=${section} query=${query} />`;
  else if (section === 'tasks') page = html`<${Tasks} />`;
  else if (section === 'settings') page = html`<${Settings} />`;
  else if (section === 'insights') page = html`<${Insights} key=${query.tab ?? ''} query=${query} />`;
  else page = html`<div class="card"><div class="empty">Page not found. <a href="#/">Go to Today</a></div></div>`;
  const link = ([path, label, icon]) => html`<a href=${`#/${path}`} class=${section === path ? 'active' : ''} title=${label} aria-label=${label}><${Icon} name=${icon} /> <span>${label}</span></a>`;
  return html`<div class="shell">
    <aside class="sidebar">
      <a class="logo" href="#/" aria-label=${BRAND.name}><img src="./brand/logo-on-dark.png" alt=${BRAND.short} /></a>
      <nav class="nav">${NAV.map(link)}</nav>
      <nav class="nav bottom">${link(['settings', 'Settings', 'settings'])}</nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <a class="mobile-logo" href="#/" aria-label=${BRAND.name}><img src="./brand/logo-on-dark.png" alt=${BRAND.short} /></a>
        <${GlobalSearch} />
        <span class="spacer" />
        <${NewMenu} />
        <a class="btn ghost icon mobile-only" href="#/settings" aria-label="Settings"><${Icon} name="settings" /></a>
      </header>
      <div class="demo-banner" role="region" aria-label="Demo mode"><div><strong>Demo mode</strong><span>100 fictional leads · Edits stay in this browser tab</span></div><button class="btn small" onClick=${resetDemo}>Reset demo</button></div>
      <main class=${`content ${section === 'pipeline' ? 'wide' : ''}`}>${page}</main>
    </div>
    <nav class="tabbar">${NAV.map(link)}</nav>
    <${QuickAdd} />
    <${Toasts} />
  </div>`;
}

document.title = BRAND.name + " · Fictional demo";
render(html`<${App} />`, document.getElementById('app'));
