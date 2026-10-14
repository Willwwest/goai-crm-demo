import { DatabaseSync, randomUUID, mkdirSync, readdirSync, rmSync, existsSync, dirname, join } from './demo-platform.mjs?v=ae938a762063';
import { ENTITIES, STAGES, ACTIVITY_TYPES, CHANNELS, PLAN_DEFAULTS, visitArea, roleGroup, personName } from '../schema.js?v=ae938a762063';
import { parseCsv, toCsv } from './csv.mjs?v=ae938a762063';
import { PRIORITY_VERSION } from './account-priority.mjs?v=ae938a762063';

export const now = () => new Date().toISOString();
const IDENT = /^[a-z][a-z0-9_]*$/;
const q = (name) => `"${name}"`;
const CLOSED_STAGES = new Set(['won', 'lost', 'disqualified']);
const ACTIVE_STAGES = STAGES.map((s) => s.value).filter((s) => !CLOSED_STAGES.has(s) && s !== 'nurture');
// Title prefix of the task a booked demo creates; it closes when the demo is held or cancelled.
const DEMO_TASK = 'Demo with';
const PERSONAL_EMAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'comcast.net', 'att.net', 'verizon.net']);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, stage_entered_at TEXT);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, channel TEXT,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  summary TEXT, body TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, due_date TEXT, done_at TEXT,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS people_company ON people(company_id);
CREATE INDEX IF NOT EXISTS people_source ON people(source);
CREATE INDEX IF NOT EXISTS people_relationship ON people(relationship, company_id);
CREATE INDEX IF NOT EXISTS people_lead_score_sort ON people((CAST(lead_score AS REAL) IS NULL OR CAST(lead_score AS REAL) = ''), CAST(lead_score AS REAL) COLLATE NOCASE DESC, id);
CREATE INDEX IF NOT EXISTS companies_priority_sort ON companies((CAST(priority AS REAL) IS NULL OR CAST(priority AS REAL) = ''), CAST(priority AS REAL) COLLATE NOCASE DESC, id);
CREATE INDEX IF NOT EXISTS people_email ON people(email COLLATE NOCASE);
-- These match the default ORDER BY in list() term for term, so the first page reads the index
-- instead of sorting every row.
CREATE INDEX IF NOT EXISTS people_name_sort ON people((ltrim(last_name, '(.-_ ') IS NULL OR ltrim(last_name, '(.-_ ') = ''), ltrim(last_name, '(.-_ ') COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS companies_name_sort ON companies((name IS NULL OR name = ''), name COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS companies_stage ON companies(stage);
CREATE INDEX IF NOT EXISTS companies_name ON companies(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS activities_company ON activities(company_id, at);
CREATE INDEX IF NOT EXISTS activities_person ON activities(person_id, at);
CREATE INDEX IF NOT EXISTS tasks_open ON tasks(done_at, due_date);
CREATE INDEX IF NOT EXISTS tasks_company ON tasks(company_id);
CREATE INDEX IF NOT EXISTS tasks_person ON tasks(person_id);
`;

function likeTerm(text) {
  return `%${String(text).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function normalizeUrl(value) {
  if (!value) return value;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || !value.includes('.') ? value : `https://${value}`;
}

function normalizeDate(value, label) {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match || Number.isNaN(Date.parse(match[1]))) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
  return match[1];
}

function domainOf(value) {
  if (!value) return '';
  const host = String(value).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
  return host.replace(/^www\./, '');
}

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    this.syncColumns();
    // Added after the first release: the date a booked demo is scheduled for.
    if (!this.all('PRAGMA table_info(activities)').some((c) => c.name === 'scheduled_for')) this.db.exec('ALTER TABLE activities ADD COLUMN scheduled_for TEXT');
    this.db.exec(INDEXES);
    this.setupSearch();
  }

  // Substring search over people (name, email, title) through an FTS5 trigram index, so a
  // search on millions of contacts does not scan every row. `seq` is a stable integer key for
  // the index: people has no integer primary key, and VACUUM may renumber rowids. If this
  // SQLite lacks FTS5 the app falls back to LIKE scans.
  setupSearch() {
    try {
      const text = (r) => `coalesce(${r}.first_name, '') || ' ' || coalesce(${r}.last_name, '') || ' ' || coalesce(${r}.email, '') || ' ' || coalesce(${r}.title, '')`;
      const columns = new Set(this.all('PRAGMA table_info(people)').map((c) => c.name));
      if (!columns.has('seq')) this.db.exec('ALTER TABLE people ADD COLUMN seq INTEGER');
      this.db.exec('UPDATE people SET seq = rowid WHERE seq IS NULL; CREATE INDEX IF NOT EXISTS people_seq ON people(seq);');
      const fresh = !this.get("SELECT 1 FROM sqlite_master WHERE name = 'people_fts'");
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS people_fts USING fts5(text, content='', contentless_delete=1, tokenize='trigram');
        CREATE TRIGGER IF NOT EXISTS people_fts_ai AFTER INSERT ON people BEGIN
          UPDATE people SET seq = new.rowid WHERE rowid = new.rowid;
          INSERT INTO people_fts(rowid, text) VALUES (new.rowid, ${text('new')});
        END;
        CREATE TRIGGER IF NOT EXISTS people_fts_au AFTER UPDATE OF first_name, last_name, email, title ON people BEGIN
          DELETE FROM people_fts WHERE rowid = old.seq;
          INSERT INTO people_fts(rowid, text) VALUES (new.seq, ${text('new')});
        END;
        CREATE TRIGGER IF NOT EXISTS people_fts_ad AFTER DELETE ON people BEGIN
          DELETE FROM people_fts WHERE rowid = old.seq;
        END;`);
      if (fresh) this.db.exec(`INSERT INTO people_fts(rowid, text) SELECT seq, ${text('people')} FROM people`);
      this.fts = true;
    } catch {
      this.fts = false;
    }
  }

  // Match expression for the people index, or null when the term is too short (the trigram
  // index needs 3 characters) or the index is unavailable.
  ftsMatch(text) {
    const term = String(text).trim();
    return this.fts && [...term].length >= 3 ? `"${term.replace(/"/g, '""')}"` : null;
  }

  close() { this.db.close(); }

  // Adds a TEXT column for each configured field that the table lacks.
  syncColumns() {
    for (const [table, def] of Object.entries(ENTITIES)) {
      const existing = new Set(this.db.prepare(`PRAGMA table_info(${q(table)})`).all().map((c) => c.name));
      for (const field of def.fields) {
        if (!IDENT.test(field.key)) throw new Error(`Invalid field key in schema.js: ${field.key}`);
        if (!existing.has(field.key)) this.db.exec(`ALTER TABLE ${q(table)} ADD COLUMN ${q(field.key)} TEXT`);
      }
    }
  }

  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }

  // Reentrant: nested calls run inside the outermost transaction.
  transaction(fn) {
    if (this.depth) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  entity(name) {
    const def = ENTITIES[name];
    if (!def) throw new HttpError(404, 'Unknown record type');
    return def;
  }

  // Returns only configured fields from input, trimmed and validated.
  clean(name, input, { partial }) {
    const out = {};
    for (const field of this.entity(name).fields) {
      if (!(field.key in input)) continue;
      let value = input[field.key];
      value = value == null ? null : String(value).trim();
      if (value === '') value = null;
      if (value && value.length > 20000) throw new HttpError(400, `${field.label} is too long`);
      if (value && field.type === 'select' && !field.options.includes(value)) {
        const match = field.options.find((o) => o.toLowerCase() === value.toLowerCase())
          ?? (field.key === 'stage' ? STAGES.find((s) => s.label.toLowerCase() === value.toLowerCase())?.value : undefined);
        if (!match) throw new HttpError(400, `${field.label} must be one of: ${field.options.join(', ')}`);
        value = match;
      }
      if (field.type === 'date') value = normalizeDate(value, field.label);
      if (field.type === 'number' && value != null) {
        if (!Number.isFinite(Number(value.replace(/,/g, '')))) throw new HttpError(400, `${field.label} must be a number`);
        value = String(Number(value.replace(/,/g, '')));
      }
      if (field.type === 'url') value = normalizeUrl(value);
      if (field.type === 'company' && value && !this.get('SELECT 1 FROM companies WHERE id = ?', value)) {
        throw new HttpError(400, 'Company not found');
      }
      out[field.key] = value;
    }
    if (!partial) {
      for (const field of this.entity(name).fields) {
        if (field.required && !out[field.key]) throw new HttpError(400, `${field.label} is required`);
      }
    } else {
      for (const field of this.entity(name).fields) {
        if (field.required && field.key in out && !out[field.key]) throw new HttpError(400, `${field.label} is required`);
      }
    }
    return out;
  }

  // ---- Companies and people -------------------------------------------------

  list(name, params = {}) {
    this.entity(name);
    const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500);
    const offset = Math.max(Number(params.offset) || 0, 0);
    const where = [];
    const bound = [];
    const param = (value) => { bound.push(value); return `?${bound.length}`; };
    const term = params.q && String(params.q).trim() ? param(likeTerm(params.q)) : null;
    let select;
    let sortable;
    if (name === 'companies') {
      select = `SELECT c.*,
        (SELECT count(*) FROM people p WHERE p.company_id = c.id) AS people_count,
        (SELECT count(*) FROM people p WHERE p.company_id = c.id AND p.relationship = 'Buyer') AS buyers_count,
        (SELECT count(*) FROM people p WHERE p.company_id = c.id AND p.relationship = 'Connection') AS warm_count,
        (SELECT max(at) FROM activities a WHERE a.company_id = c.id AND a.type <> 'Stage change') AS last_activity_at,
        (SELECT count(*) FROM tasks t WHERE t.company_id = c.id AND t.done_at IS NULL) AS open_tasks,
        (SELECT min(due_date) FROM tasks t WHERE t.company_id = c.id AND t.done_at IS NULL) AS next_due
        FROM companies c`;
      if (term) {
        where.push(`(c.name LIKE ${term} ESCAPE '\\' OR c.website LIKE ${term} ESCAPE '\\' OR c.city LIKE ${term} ESCAPE '\\' OR c.state LIKE ${term} ESCAPE '\\')`);
      }
      if (params.stage === 'none') where.push('c.stage IS NULL');
      else if (params.stage === 'pipeline') where.push('c.stage IS NOT NULL');
      else if (params.stage) where.push(`c.stage = ${param(params.stage)}`);
      // Views: targets (any priority tier), pipeline (any stage), all.
      if (params.view === 'targets') where.push('c.tier IS NOT NULL');
      else if (params.view === 'pipeline') where.push('c.stage IS NOT NULL');
      sortable = { name: 'c.name', stage: 'c.stage', website: 'c.website', state: 'c.state', created_at: 'c.created_at', updated_at: 'c.updated_at', last_activity_at: 'last_activity_at', people_count: 'people_count', buyers_count: 'buyers_count', warm_count: 'warm_count', stage_entered_at: 'c.stage_entered_at', next_due: 'next_due' };
    } else {
      select = `SELECT p.*, c.name AS company_name, c.stage AS company_stage, c.tier AS company_tier, c.fit_score AS company_fit,
        (SELECT max(at) FROM activities a WHERE a.person_id = p.id) AS last_activity_at
        FROM people p LEFT JOIN companies c ON c.id = p.company_id`;
      // Views: buyers and connections map to the relationship field.
      if (params.view === 'buyers') where.push("p.relationship = 'Buyer'");
      else if (params.view === 'connections') where.push("p.relationship = 'Connection'");
      else if (params.view === 'purchased') where.push("p.source = 'Purchased'");
      if (term) {
        const match = this.ftsMatch(params.q);
        if (match) {
          where.push(`(p.seq IN (SELECT rowid FROM people_fts WHERE people_fts MATCH ${param(match)})
            OR p.company_id IN (SELECT id FROM companies WHERE name LIKE ${term} ESCAPE '\\'))`);
        } else {
          where.push(`((coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) LIKE ${term} ESCAPE '\\'
            OR p.email LIKE ${term} ESCAPE '\\' OR p.title LIKE ${term} ESCAPE '\\' OR c.name LIKE ${term} ESCAPE '\\')`);
        }
      }
      if (params.company_id) where.push(`p.company_id = ${param(params.company_id)}`);
      // Skip leading punctuation that LinkedIn names often carry, e.g. "(Basden) Reiser".
      sortable = { name: "ltrim(p.last_name, '(.-_ ')", first_name: 'p.first_name', last_name: 'p.last_name', title: 'p.title', company_id: 'company_name', email: 'p.email', relationship: 'p.relationship', connected_on: 'p.connected_on', created_at: 'p.created_at', updated_at: 'p.updated_at', last_activity_at: 'last_activity_at', company_fit: 'CAST(c.fit_score AS REAL)' };
    }
    // Any select field other than stage filters by equality, e.g. ?tier=A or ?relationship=Buyer.
    const alias = name === 'companies' ? 'c' : 'p';
    for (const field of this.entity(name).fields) {
      if (field.type === 'select' && field.key !== 'stage' && params[field.key]) where.push(`${alias}.${q(field.key)} = ${param(params[field.key])}`);
    }
    sortable = {
      ...Object.fromEntries(this.entity(name).fields.map((f) => [f.key, f.type === 'number' ? `CAST(${alias}.${q(f.key)} AS REAL)` : `${alias}.${q(f.key)}`])),
      ...sortable,
    };
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const sortColumn = sortable[params.sort] ?? (name === 'companies' ? 'c.name' : 'p.last_name');
    const dir = params.dir === 'desc' ? 'DESC' : 'ASC';
    const order = ` ORDER BY (${sortColumn} IS NULL OR ${sortColumn} = ''), ${sortColumn} COLLATE NOCASE ${dir}, ${name === 'companies' ? 'c' : 'p'}.id`;
    const rows = this.all(`${select}${whereSql}${order} LIMIT ${limit} OFFSET ${offset}`, ...bound);
    const countSql = name === 'companies'
      ? `SELECT count(*) AS n FROM companies c${whereSql}`
      : `SELECT count(*) AS n FROM people p${/\bc\./.test(whereSql) ? ' LEFT JOIN companies c ON c.id = p.company_id' : ''}${whereSql}`;    const { n } = this.get(countSql, ...bound);
    return { rows, total: n, limit, offset };
  }

  find(name, id) {
    this.entity(name);
    const row = this.get(`SELECT * FROM ${q(name)} WHERE id = ?`, id);
    if (!row) throw new HttpError(404, `${this.entity(name).singular} not found`);
    return row;
  }

  detail(name, id) {
    const record = this.find(name, id);
    const column = name === 'companies' ? 'company_id' : 'person_id';
    const activities = this.all(`SELECT a.*, p.first_name, p.last_name, c.name AS company_name
      FROM activities a LEFT JOIN people p ON p.id = a.person_id LEFT JOIN companies c ON c.id = a.company_id
      WHERE a.${column} = ? ORDER BY a.at DESC, a.created_at DESC LIMIT 500`, id);
    const tasks = this.all(`SELECT t.*, p.first_name, p.last_name, c.name AS company_name
      FROM tasks t LEFT JOIN people p ON p.id = t.person_id LEFT JOIN companies c ON c.id = t.company_id
      WHERE t.${column} = ? ORDER BY t.done_at IS NOT NULL, coalesce(t.due_date, '9999'), t.created_at`, id);
    if (name === 'companies') {
      // Buyers first, then your connections, then everyone else.
      const people = this.all(`SELECT id, first_name, last_name, title, email, phone, linkedin_url, relationship FROM people
        WHERE company_id = ? ORDER BY CASE relationship WHEN 'Buyer' THEN 0 WHEN 'Connection' THEN 1 ELSE 2 END,
        last_name COLLATE NOCASE, first_name COLLATE NOCASE LIMIT 500`, id);
      return { record, people, activities, tasks };
    }
    const company = record.company_id
      ? this.get('SELECT id, name, stage, tier, segment, city, fit_score, hypothesis FROM companies WHERE id = ?', record.company_id) : null;
    // The company's buyers, so a connection's page can ask for an introduction to one.
    const colleagues = record.company_id ? this.all(`SELECT id, first_name, last_name, title, email, phone, linkedin_url, relationship FROM people
      WHERE company_id = ? AND id <> ? AND relationship IN ('Buyer', 'Connection')
      ORDER BY relationship, last_name COLLATE NOCASE, first_name COLLATE NOCASE LIMIT 50`, record.company_id, id) : [];
    return { record, company, colleagues, activities, tasks };
  }

  // Finds a company by exact name, then by website domain; creates one if needed.
  resolveCompany({ name, website, email }) {
    const cleanName = name?.trim();
    if (cleanName) {
      const existing = this.get('SELECT id FROM companies WHERE name = ? COLLATE NOCASE', cleanName);
      if (existing) return existing.id;
    }
    let domain = domainOf(website);
    if (!domain && email && email.includes('@')) {
      const emailDomain = email.split('@').pop().trim().toLowerCase();
      if (!PERSONAL_EMAIL.has(emailDomain)) domain = emailDomain;
    }
    if (domain) {
      const byDomain = this.all('SELECT id, website FROM companies WHERE website LIKE ? ESCAPE \'\\\'', likeTerm(domain))
        .find((c) => domainOf(c.website) === domain);
      if (byDomain) return byDomain.id;
    }
    if (!cleanName && !domain) return null;
    const label = cleanName || domain.split('.').slice(-2, -1)[0].replace(/^./, (c) => c.toUpperCase());
    return this.create('companies', { name: label, website: domain || null }).id;
  }

  // People accept `company_name`, `company_website` or a business email in place of
  // `company_id`; a matching company is found or created.
  create(name, input) {
    const values = this.clean(name, input, { partial: false });
    return this.transaction(() => {
      if (name === 'people' && !values.company_id && (input.company_name || input.company_website || values.email)) {
        values.company_id = this.resolveCompany({ name: input.company_name, website: input.company_website, email: values.email });
      }
      const ts = now();
      const row = { id: randomUUID(), created_at: ts, updated_at: ts, ...values };
      if (name === 'companies' && values.stage) row.stage_entered_at = ts;
      const keys = Object.keys(row);
      this.run(`INSERT INTO ${q(name)} (${keys.map(q).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => row[k]));
      return this.find(name, row.id);
    });
  }

  update(name, id, input) {
    const before = this.find(name, id);
    const values = this.clean(name, input, { partial: true });
    return this.transaction(() => {
      if (name === 'people' && 'company_name' in input && !('company_id' in input)) {
        values.company_id = input.company_name ? this.resolveCompany({ name: input.company_name }) : null;
      }
      const changed = Object.keys(values).filter((k) => values[k] !== before[k]);
      if (!changed.length) return before;
      const ts = now();
      const set = { ...Object.fromEntries(changed.map((k) => [k, values[k]])), updated_at: ts };
      if (name === 'companies' && changed.includes('stage')) {
        set.stage_entered_at = values.stage ? ts : null;
        const label = (v) => STAGES.find((s) => s.value === v)?.label ?? 'Not in pipeline';
        this.run(`INSERT INTO activities (id, at, type, company_id, summary, created_at) VALUES (?, ?, 'Stage change', ?, ?, ?)`,
          randomUUID(), ts, id, `${label(before.stage)} → ${label(values.stage)}`, ts);
      }
      const keys = Object.keys(set);
      this.run(`UPDATE ${q(name)} SET ${keys.map((k) => `${q(k)} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => set[k]), id);
      return this.find(name, id);
    });
  }

  remove(name, id) {
    this.find(name, id);
    this.transaction(() => {
      if (name === 'people') {
        // Keep company history; drop entries that only belonged to this person.
        this.run('DELETE FROM activities WHERE person_id = ? AND company_id IS NULL', id);
        this.run('DELETE FROM tasks WHERE person_id = ? AND company_id IS NULL', id);
      }
      this.run(`DELETE FROM ${q(name)} WHERE id = ?`, id);
    });
    return { deleted: id };
  }

  // Applies one patch (e.g. { stage: 'research' }) to up to 500 records at once.
  bulkUpdate(name, ids, patch) {
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Choose at least one record');
    if (ids.length > 500) throw new HttpError(400, 'Update up to 500 records at a time');
    return this.transaction(() => ({ updated: ids.map((id) => this.update(name, String(id), patch ?? {})).length }));
  }

  // ---- Activities and tasks -------------------------------------------------

  links(input) {
    let companyId = input.company_id || null;
    const personId = input.person_id || null;
    if (personId) {
      const person = this.get('SELECT company_id FROM people WHERE id = ?', personId);
      if (!person) throw new HttpError(400, 'Person not found');
      companyId ??= person.company_id;
    }
    if (companyId && !this.get('SELECT 1 FROM companies WHERE id = ?', companyId)) throw new HttpError(400, 'Company not found');
    return { companyId, personId };
  }

  addActivity(input) {
    const type = String(input.type ?? 'Note').trim();
    if (!ACTIVITY_TYPES.includes(type)) throw new HttpError(400, `Type must be one of: ${ACTIVITY_TYPES.join(', ')}`);
    const channel = input.channel ? String(input.channel).trim() : null;
    if (channel && !CHANNELS.includes(channel)) throw new HttpError(400, `Channel must be one of: ${CHANNELS.join(', ')}`);
    const summary = input.summary ? String(input.summary).trim().slice(0, 500) : null;
    const body = input.body ? String(input.body).trim().slice(0, 20000) : null;
    if (!summary && !body) throw new HttpError(400, 'Add a summary or notes');
    const { companyId, personId } = this.links(input);
    if (!companyId && !personId) throw new HttpError(400, 'Link the activity to a company or person');
    let at = now();
    if (input.at) {
      const day = normalizeDate(String(input.at), 'Date');
      at = day === input.at ? `${day}T12:00:00.000Z` : new Date(input.at).toISOString();
    }
    const scheduledFor = type === 'Demo booked' ? normalizeDate(input.scheduled_for, 'Demo date') : null;
    if (type === 'Demo booked' && !scheduledFor) throw new HttpError(400, 'Add the demo date');
    const ts = now();
    return this.transaction(() => {
      const id = randomUUID();
      this.run('INSERT INTO activities (id, at, type, channel, company_id, person_id, summary, body, scheduled_for, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, at, type, channel, companyId, personId, summary, body, scheduledFor, ts);
      // A booked demo is the account's next step until it is held, moved or cancelled.
      if (type === 'Demo held' && companyId) this.closeDemoTasks(companyId, ts);
      let task = null;
      if (scheduledFor) {
        task = this.createTask({ title: `${DEMO_TASK} ${this.demoWho(companyId, personId)}`, due_date: scheduledFor, company_id: companyId, person_id: personId });
      } else if (input.next_action && String(input.next_action).trim()) {
        task = this.createTask({ title: input.next_action, due_date: input.next_due, company_id: companyId, person_id: personId });
      }
      return { activity: this.get('SELECT * FROM activities WHERE id = ?', id), task };
    });
  }

  demoWho(companyId, personId) {
    const person = personId ? this.get('SELECT first_name, last_name FROM people WHERE id = ?', personId) : null;
    return person ? personName(person) : this.get('SELECT name FROM companies WHERE id = ?', companyId)?.name ?? 'the buyer';
  }

  closeDemoTasks(companyId, ts) {
    this.run(`UPDATE tasks SET done_at = ?, updated_at = ? WHERE company_id = ? AND done_at IS NULL AND title LIKE '${DEMO_TASK} %'`, ts, ts, companyId);
  }

  // What the assistant is told about an account: the record, its buyers and connections,
  // and recent history. Only CRM data; nothing is looked up anywhere else.
  aiContext({ company_id: companyId, person_id: personId, connection_id: connectionId } = {}) {
    const person = personId ? this.get('SELECT * FROM people WHERE id = ?', personId) : null;
    if (personId && !person) throw new HttpError(404, 'Person not found');
    companyId ||= person?.company_id ?? null;
    const company = companyId ? this.get('SELECT * FROM companies WHERE id = ?', companyId) : null;
    if (companyId && !company) throw new HttpError(404, 'Company not found');
    if (!company && !person) throw new HttpError(400, 'Choose an account or person');
    const connection = connectionId ? this.get('SELECT * FROM people WHERE id = ?', connectionId) : null;
    const people = company ? this.all(`SELECT first_name, last_name, title, relationship FROM people WHERE company_id = ?
      AND relationship IN ('Buyer', 'Connection') ORDER BY relationship, last_name COLLATE NOCASE LIMIT 12`, company.id) : [];
    const history = this.all(`SELECT a.at, a.type, a.channel, a.summary, a.body, a.scheduled_for, p.first_name, p.last_name
      FROM activities a LEFT JOIN people p ON p.id = a.person_id
      WHERE ${company ? 'a.company_id' : 'a.person_id'} = ? AND a.type <> 'Stage change' ORDER BY a.at DESC LIMIT 8`, company?.id ?? person.id).reverse();
    return { company, person, connection, people, history, me: this.getPlan().name };
  }

  // Moves a booked demo to a new date, or records that it did not happen. The open
  // "Demo with ..." task follows the new date or closes, and a note keeps the history.
  changeDemo(id, input) {
    const demo = this.get("SELECT * FROM activities WHERE id = ? AND type = 'Demo booked'", id);
    if (!demo) throw new HttpError(404, 'Booked demo not found');
    const ts = now();
    const who = this.demoWho(demo.company_id, demo.person_id);
    return this.transaction(() => {
      if (input.action === 'reschedule') {
        const date = normalizeDate(input.date, 'Demo date');
        if (!date) throw new HttpError(400, 'Add the new demo date');
        this.run('UPDATE activities SET scheduled_for = ? WHERE id = ?', date, id);
        this.run(`UPDATE tasks SET due_date = ?, updated_at = ? WHERE company_id = ? AND done_at IS NULL AND title LIKE '${DEMO_TASK} %'`, date, ts, demo.company_id);
        this.addActivity({ type: 'Note', company_id: demo.company_id, person_id: demo.person_id, summary: `Demo with ${who} moved to ${date}`, body: input.body });
      } else if (input.action === 'cancel') {
        this.run('UPDATE activities SET scheduled_for = NULL WHERE id = ?', id);
        this.closeDemoTasks(demo.company_id, ts);
        this.addActivity({ type: 'Note', company_id: demo.company_id, person_id: demo.person_id, summary: `Demo with ${who} did not happen`, body: input.body,
          next_action: input.next_action, next_due: input.next_due });
      } else {
        throw new HttpError(400, 'Action must be reschedule or cancel');
      }
      return this.get('SELECT * FROM activities WHERE id = ?', id);
    });
  }

  updateActivity(id, input) {
    const before = this.get('SELECT * FROM activities WHERE id = ?', id);
    if (!before) throw new HttpError(404, 'Activity not found');
    const summary = 'summary' in input ? (String(input.summary ?? '').trim() || null) : before.summary;
    const body = 'body' in input ? (String(input.body ?? '').trim() || null) : before.body;
    if (!summary && !body) throw new HttpError(400, 'Add a summary or notes');
    this.run('UPDATE activities SET summary = ?, body = ? WHERE id = ?', summary, body, id);
    return this.get('SELECT * FROM activities WHERE id = ?', id);
  }

  removeActivity(id) {
    if (!this.run('DELETE FROM activities WHERE id = ?', id).changes) throw new HttpError(404, 'Activity not found');
    return { deleted: id };
  }

  listTasks({ status = 'open', limit = 200 } = {}) {
    const max = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const filter = status === 'done' ? 'WHERE t.done_at IS NOT NULL' : status === 'all' ? '' : 'WHERE t.done_at IS NULL';
    const order = status === 'done' ? 'ORDER BY t.done_at DESC' : "ORDER BY coalesce(t.due_date, '9999'), t.created_at";
    return this.all(`SELECT t.*, p.first_name, p.last_name, c.name AS company_name, c.stage AS company_stage
      FROM tasks t LEFT JOIN people p ON p.id = t.person_id LEFT JOIN companies c ON c.id = t.company_id
      ${filter} ${order} LIMIT ${max}`);
  }

  getTask(id) {
    const task = this.get(`SELECT t.*, p.first_name, p.last_name, c.name AS company_name FROM tasks t
      LEFT JOIN people p ON p.id = t.person_id LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ?`, id);
    if (!task) throw new HttpError(404, 'Task not found');
    return task;
  }

  createTask(input) {
    const title = String(input.title ?? '').trim().slice(0, 500);
    if (!title) throw new HttpError(400, 'Task title is required');
    const { companyId, personId } = this.links(input);
    const id = randomUUID();
    const ts = now();
    this.run('INSERT INTO tasks (id, title, due_date, company_id, person_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, title, normalizeDate(input.due_date, 'Due date'), companyId, personId, ts, ts);
    return this.getTask(id);
  }

  updateTask(id, input) {
    const before = this.getTask(id);
    const title = 'title' in input ? String(input.title ?? '').trim().slice(0, 500) : before.title;
    if (!title) throw new HttpError(400, 'Task title is required');
    const due = 'due_date' in input ? normalizeDate(input.due_date, 'Due date') : before.due_date;
    const doneAt = 'done' in input ? (input.done ? before.done_at ?? now() : null) : before.done_at;
    this.run('UPDATE tasks SET title = ?, due_date = ?, done_at = ?, updated_at = ? WHERE id = ?', title, due, doneAt, now(), id);
    return this.getTask(id);
  }

  removeTask(id) {
    if (!this.run('DELETE FROM tasks WHERE id = ?', id).changes) throw new HttpError(404, 'Task not found');
    return { deleted: id };
  }

  // ---- Dashboard and search -------------------------------------------------

  dashboard(today) {
    const day = normalizeDate(today, 'Today') ?? now().slice(0, 10);
    const week = new Date(Date.parse(`${day}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
    const stages = Object.fromEntries(this.all('SELECT stage, count(*) AS n FROM companies WHERE stage IS NOT NULL GROUP BY stage').map((r) => [r.stage, r.n]));
    const open = this.listTasks({ status: 'open', limit: 1000 });
    const placeholders = ACTIVE_STAGES.map(() => '?').join(', ');
    return {
      totals: {
        companies: this.get('SELECT count(*) AS n FROM companies').n,
        people: this.get('SELECT count(*) AS n FROM people').n,
        pipeline: ACTIVE_STAGES.reduce((sum, s) => sum + (stages[s] ?? 0), 0),
        openTasks: open.length,
      },
      stages,
      overdue: open.filter((t) => t.due_date && t.due_date < day),
      dueToday: open.filter((t) => t.due_date === day),
      upcoming: open.filter((t) => t.due_date && t.due_date > day && t.due_date <= week),
      // Active pipeline accounts with no open next action, per the field guide.
      orphanedCount: this.get(`SELECT count(*) AS n FROM companies c WHERE c.stage IN (${placeholders})
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.company_id = c.id AND t.done_at IS NULL)`, ...ACTIVE_STAGES).n,
      orphaned: this.all(`SELECT c.id, c.name, c.stage, c.stage_entered_at FROM companies c
        WHERE c.stage IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.company_id = c.id AND t.done_at IS NULL)
        ORDER BY c.stage_entered_at LIMIT 20`, ...ACTIVE_STAGES),
      recent: this.all(`SELECT a.*, p.first_name, p.last_name, c.name AS company_name FROM activities a
        LEFT JOIN people p ON p.id = a.person_id LEFT JOIN companies c ON c.id = a.company_id
        ORDER BY a.at DESC, a.created_at DESC LIMIT 12`),
    };
  }

  // ---- 60-day plan and the Today page -----------------------------------------

  getPlan() {
    const row = this.get("SELECT value FROM settings WHERE key = 'plan'");
    let saved = {};
    try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
    return {
      start: saved.start ?? PLAN_DEFAULTS.start,
      days: saved.days ?? PLAN_DEFAULTS.days,
      weekly: { ...PLAN_DEFAULTS.weekly, ...saved.weekly },
      goals: { ...PLAN_DEFAULTS.goals, ...saved.goals },
      rates: { ...PLAN_DEFAULTS.rates, ...saved.rates },
      name: saved.name ?? '',
      saved: !!row,
    };
  }

  savePlan(input) {
    const count = (value, label) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError(400, `${label} must be a whole number`);
      return n;
    };
    const start = normalizeDate(input.start, 'Start date');
    if (!start) throw new HttpError(400, 'Start date is required');
    const days = count(input.days ?? PLAN_DEFAULTS.days, 'Length in days');
    if (days < 1) throw new HttpError(400, 'Length in days must be at least 1');
    const pick = (group, defaults) => Object.fromEntries(Object.keys(defaults).map((k) => [k, count(input[group]?.[k] ?? defaults[k], k)]));
    const name = String(input.name ?? '').trim().slice(0, 80);
    const rates = pick('rates', PLAN_DEFAULTS.rates);
    if (Object.values(rates).some((r) => r < 1 || r > 100)) throw new HttpError(400, 'Rates must be between 1 and 100 percent');
    const plan = { start, days, name, weekly: pick('weekly', PLAN_DEFAULTS.weekly), goals: pick('goals', PLAN_DEFAULTS.goals), rates };
    this.run("INSERT INTO settings (key, value) VALUES ('plan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(plan));
    return this.getPlan();
  }

  // Everything the Today page shows: plan progress, this week against the weekly
  // targets, progress toward the plan's goals, booked demos, the ranked focus list and
  // recent touches. The focus list covers accounts in an active pipeline stage.
  // `tz` is the browser's getTimezoneOffset() in minutes, so activity counts use the
  // reader's local date (an evening touch in Arizona is already tomorrow in UTC).
  today(today, tz) {
    const day = normalizeDate(today, 'Today') ?? now().slice(0, 10);
    const dayMs = Date.parse(`${day}T00:00:00Z`);
    const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
    const offset = Number.isFinite(Number(tz)) ? Number(tz) : 0;
    const localDate = (at) => new Date(Date.parse(at) - offset * 60000).toISOString().slice(0, 10);
    const plan = this.getPlan();
    const start = plan.start ?? day;
    const dayNumber = Math.floor((dayMs - Date.parse(`${start}T00:00:00Z`)) / 864e5) + 1;
    const weekStart = iso(dayMs - ((new Date(dayMs).getUTCDay() + 6) % 7) * 864e5);
    const since = start < weekStart ? start : weekStart;

    // Fetch from a day early so local-date filtering below sees every candidate row.
    const touches = this.all("SELECT at, type, channel, company_id FROM activities WHERE type NOT IN ('Stage change', 'Note') AND at >= ?", iso(Date.parse(`${since}T00:00:00Z`) - 864e5));
    const inRange = (a, from) => localDate(a.at) >= from && localDate(a.at) <= day;
    const stageIndex = (label) => STAGES.findIndex((s) => s.label === label);
    const moves = this.all("SELECT at, company_id, summary FROM activities WHERE type = 'Stage change' AND at >= ?", iso(Date.parse(`${since}T00:00:00Z`) - 864e5)).map((m) => {
      const [from, to] = String(m.summary ?? '').split(' → ');
      return { at: m.at, company_id: m.company_id, from: stageIndex(from), to: stageIndex(to), toValue: STAGES[stageIndex(to)]?.value };
    });
    const researchIndex = STAGES.findIndex((s) => s.value === 'research');
    const forward = (m) => m.to > m.from && m.to > researchIndex && !['lost', 'disqualified', 'nurture'].includes(m.toValue);
    const reached = (values, from) => new Set(moves.filter((m) => inRange(m, from) && values.includes(m.toValue)).map((m) => m.company_id)).size;
    // A booking records the outcome of a touch already logged, so it is not a touch itself.
    const effort = touches.filter((a) => a.type !== 'Demo booked');
    const week = {
      today: effort.filter((a) => localDate(a.at) === day).length,
      touches: effort.filter((a) => inRange(a, weekStart)).length,
      intros: touches.filter((a) => inRange(a, weekStart) && a.type === 'Intro request').length,
      booked: touches.filter((a) => inRange(a, weekStart) && a.type === 'Demo booked').length,
      demos: touches.filter((a) => inRange(a, weekStart) && a.type === 'Demo held').length,
      advanced: new Set(moves.filter((m) => inRange(m, weekStart) && forward(m)).map((m) => m.company_id)).size,
    };
    const toDate = {
      demos: touches.filter((a) => inRange(a, start) && a.type === 'Demo held').length,
      booked: touches.filter((a) => inRange(a, start) && a.type === 'Demo booked').length,
      qualified: reached(['qualified', 'opportunity', 'won'], start),
      opportunities: reached(['opportunity', 'won'], start),
    };
    // Accounts at each step since the start date: cold starts (outreach or a call), intro
    // requests, replies, bookings and demos held. Today compares these with the plan's rates.
    const accountsWith = (types) => new Set(touches.filter((a) => a.company_id && inRange(a, start) && types.includes(a.type)).map((a) => a.company_id)).size;
    const funnel = {
      cold: accountsWith(['Outreach', 'Call']), warm: accountsWith(['Intro request']), replied: accountsWith(['Reply']),
      booked: accountsWith(['Demo booked']), held: accountsWith(['Demo held']),
    };

    // Booked demos still open: the latest booking per account that has a date and no demo
    // held since. Past dates need an outcome; future ones are on the calendar.
    const pending = this.all(`SELECT a.id, a.company_id, a.person_id, a.scheduled_for AS date, c.name AS company_name, c.tier, c.stage,
        p.first_name, p.last_name, p.title, p.email, p.phone, p.linkedin_url
      FROM activities a JOIN companies c ON c.id = a.company_id LEFT JOIN people p ON p.id = a.person_id
      WHERE a.type = 'Demo booked' AND a.scheduled_for IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM activities h WHERE h.company_id = a.company_id AND h.type = 'Demo held' AND h.at >= a.at)
        AND NOT EXISTS (SELECT 1 FROM activities b WHERE b.company_id = a.company_id AND b.type = 'Demo booked' AND b.at > a.at)
      ORDER BY a.scheduled_for`).map((d) => ({
      id: d.id, date: d.date, company_id: d.company_id, company_name: d.company_name, tier: d.tier, stage: d.stage,
      person: d.person_id ? { id: d.person_id, name: personName(d), title: d.title, email: d.email, phone: d.phone, linkedin_url: d.linkedin_url } : null,
    }));
    const demos = { upcoming: pending.filter((d) => d.date >= day), awaiting: pending.filter((d) => d.date < day) };
    const demoByCompany = new Map(pending.map((d) => [d.company_id, d]));

    // Focus list: active pipeline accounts ranked by what needs doing.
    const placeholders = ACTIVE_STAGES.map(() => '?').join(', ');
    const accounts = this.all(`SELECT id, name, stage, tier, fit_score, segment, city, hypothesis FROM companies WHERE stage IN (${placeholders})`, ...ACTIVE_STAGES);
    const team = new Map();
    for (const p of this.all(`SELECT id, first_name, last_name, title, relationship, company_id, email, phone, linkedin_url FROM people
        WHERE relationship IN ('Buyer', 'Connection') AND company_id IN (SELECT id FROM companies WHERE stage IN (${placeholders}))
        ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`, ...ACTIVE_STAGES)) {
      if (!team.has(p.company_id)) team.set(p.company_id, []);
      team.get(p.company_id).push({ id: p.id, name: personName(p), title: p.title, relationship: p.relationship, email: p.email, phone: p.phone, linkedin_url: p.linkedin_url });
    }
    // Per account: when it was last touched, the last two-way interaction (to spot a reply
    // waiting on you), and how many outbound touches it has had (the sequence is three).
    const lastTouch = new Map();
    const lastExchange = new Map();
    const outbound = new Map();
    for (const a of this.all(`SELECT company_id, person_id, at, type, summary, body FROM activities WHERE type <> 'Stage change'
        AND company_id IN (SELECT id FROM companies WHERE stage IN (${placeholders})) ORDER BY at`, ...ACTIVE_STAGES)) {
      lastTouch.set(a.company_id, a.at);
      if (a.type !== 'Note') lastExchange.set(a.company_id, a);
      if (a.type === 'Outreach' || a.type === 'Call') outbound.set(a.company_id, (outbound.get(a.company_id) ?? 0) + 1);
    }
    const personById = new Map([...team.values()].flat().map((p) => [p.id, p]));
    const nextTask = new Map();
    for (const t of this.all(`SELECT id, title, due_date, company_id FROM tasks WHERE done_at IS NULL
        AND company_id IN (SELECT id FROM companies WHERE stage IN (${placeholders})) ORDER BY coalesce(due_date, '9999'), created_at`, ...ACTIVE_STAGES)) {
      if (!nextTask.has(t.company_id)) nextTask.set(t.company_id, t);
    }
    const TIER_POINTS = { A: 20, B: 12, C: 5 };
    // The buyer to aim at first: technology and executive owners before other roles.
    const ROLE_ORDER = ['Technology', 'Executive', 'Security', 'Risk & compliance', 'Strategy & AI', 'Clinical', 'Other'];
    const rank = (p) => ROLE_ORDER.indexOf(roleGroup(p.title)) + 1 || ROLE_ORDER.length + 1;
    // "Why: ..." and "Offer: ..." from research notes, when present.
    const note = (text, label, until) => {
      const m = new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\s*(?:${until.join('|')}):|$)`).exec(text ?? '');
      const value = m?.[1]?.trim();
      return value ? (value.length > 260 ? `${value.slice(0, 257)}…` : value) : null;
    };
    const focus = accounts.map((a) => {
      const members = team.get(a.id) ?? [];
      const buyers = members.filter((p) => p.relationship === 'Buyer').sort((x, y) => rank(x) - rank(y));
      const warm = members.filter((p) => p.relationship === 'Connection');
      const task = nextTask.get(a.id) ?? null;
      const touched = lastTouch.get(a.id) ?? null;
      const idle = touched ? Math.floor((dayMs - Date.parse(`${localDate(touched)}T00:00:00Z`)) / 864e5) : null;
      const fit = a.fit_score == null || a.fit_score === '' ? null : Number(a.fit_score);
      const demo = demoByCompany.get(a.id) ?? null;
      const exchange = lastExchange.get(a.id);
      const replyWaiting = !demo && exchange?.type === 'Reply';
      const reasons = [];
      let score = (TIER_POINTS[a.tier] ?? 0) + (fit ?? 0) / 10;
      let action = null;
      if (demo) score -= 40;
      else if (task?.due_date && task.due_date < day) { score += 100; reasons.push({ kind: 'overdue', text: `Overdue since ${task.due_date}` }); action = task.title; }
      else if (task?.due_date === day) { score += 80; reasons.push({ kind: 'due', text: 'Due today' }); action = task.title; }
      else if (task) score -= 40;
      else { score += 30; reasons.push({ kind: 'none', text: 'No next action' }); }
      if (warm.length) { score += 15; reasons.push({ kind: 'warm', text: `Warm path: ${warm[0].name}` }); }
      if (!touched) { score += 10; reasons.push({ kind: 'new', text: 'Not touched yet' }); }
      else if (idle > 14) { score += 10; reasons.push({ kind: 'idle', text: `No touch in ${idle} days` }); }
      if (!buyers.length) reasons.push({ kind: 'gap', text: 'No buyer contact' });
      let target = buyers[0] ?? null;
      // kind picks the outcome buttons the page offers. The ones closest to a demo come first:
      // a demo date that has passed, a demo in the next two days, then a reply waiting on you.
      let kind;
      if (demo?.date < day) {
        kind = 'demo'; target = (demo.person && personById.get(demo.person.id)) ?? demo.person ?? target; score += 220;
        action = `Did the demo with ${target?.name ?? a.name} happen?`;
        reasons.unshift({ kind: 'demo', text: `Demo was ${demo.date}` });
      } else if (demo) {
        // Booked: the demo is the next step. It only climbs the queue in the last two days.
        kind = 'prep'; target = (demo.person && personById.get(demo.person.id)) ?? demo.person ?? target;
        action = `Prepare for the demo with ${target?.name ?? a.name}`;
        if (demo.date <= iso(dayMs + 2 * 864e5)) {
          score += 120;
          reasons.unshift({ kind: 'demo', text: demo.date === day ? 'Demo today' : `Demo ${demo.date}` });
        }
      } else if (replyWaiting) {
        target = personById.get(exchange.person_id) ?? target; score += 150;
        kind = 'reply'; action = `Answer ${target?.name ?? 'their reply'} and offer demo times`;
        reasons.unshift({ kind: 'reply', text: `Replied ${localDate(exchange.at)}` });
      }
      const who = target ? `${target.name}${target.title ? `, ${target.title}` : ''}` : null;
      if (!kind) {
        if (action) kind = 'task';
        else if (warm.length && !touched) { kind = 'intro'; action = `Ask ${warm[0].name} for an introduction${who ? ` to ${who}` : ''}`; }
        else if (!target) { kind = 'research'; action = 'Find a buyer contact'; }
        else if (!touched) { kind = 'outreach'; action = `First outreach to ${who}`; }
        else { kind = 'follow'; action = `Follow up with ${who}`; }
      }
      return {
        id: a.id, name: a.name, stage: a.stage, tier: a.tier, fit, segment: a.segment, city: a.city, score: Math.round(score * 10) / 10,
        kind, reasons, action, task, last_touch: touched, target, buyers: buyers.slice(0, 3), connections: warm.slice(0, 3),
        demo, outbound: outbound.get(a.id) ?? 0,
        reply: replyWaiting ? { at: exchange.at, summary: exchange.summary, body: exchange.body } : null,
        why: note(a.hypothesis, 'Why', ['Offer', 'Scoring note']), offer: note(a.hypothesis, 'Offer', ['Scoring note']),
      };
    }).sort((x, y) => y.score - x.score).slice(0, 12);

    const open = this.listTasks({ status: 'open', limit: 1000 });
    const stages = Object.fromEntries(this.all('SELECT stage, count(*) AS n FROM companies WHERE stage IS NOT NULL GROUP BY stage').map((r) => [r.stage, r.n]));
    return {
      today: day,
      plan,
      progress: { day: dayNumber, started: dayNumber >= 1, weekStart, weekday: Math.min(5, ((new Date(dayMs).getUTCDay() + 6) % 7) + 1) },
      week,
      toDate,
      funnel,
      demos,
      focus,
      pipelineAccounts: accounts.length,
      withoutNextAction: accounts.filter((a) => !nextTask.has(a.id)).length,
      // Accounts nobody has touched yet: how many can take a first touch now, and how many
      // of those have a connection who could introduce you.
      untouched: {
        ready: accounts.filter((a) => !lastTouch.has(a.id) && (team.get(a.id) ?? []).some((p) => p.relationship === 'Buyer')).length,
        warm: accounts.filter((a) => !lastTouch.has(a.id) && (team.get(a.id) ?? []).some((p) => p.relationship === 'Connection')).length,
      },
      due: { overdue: open.filter((t) => t.due_date && t.due_date < day).length, today: open.filter((t) => t.due_date === day).length },
      stages,
      recent: this.all(`SELECT a.*, p.first_name, p.last_name, c.name AS company_name FROM activities a
        LEFT JOIN people p ON p.id = a.person_id LEFT JOIN companies c ON c.id = a.company_id
        WHERE a.type <> 'Stage change' ORDER BY a.at DESC, a.created_at DESC LIMIT 8`),
    };
  }

  // ---- Analytics ------------------------------------------------------------

  // Data for the Insights page: one row per target account (any tier) or
  // pipeline account (any stage), plus activity and stage-movement aggregates.
  // The browser filters and draws; it does not query further.
  analytics(today, tz) {
    const day = normalizeDate(today, 'Today') ?? now().slice(0, 10);
    const dayMs = Date.parse(`${day}T00:00:00Z`);
    const daysAgo = (n) => new Date(dayMs - n * 864e5).toISOString().slice(0, 10);
    // Activity dates in the reader's time zone (tz = getTimezoneOffset() minutes).
    const offset = Number.isFinite(Number(tz)) ? Number(tz) : 0;
    const localDate = (at) => new Date(Date.parse(at) - offset * 60000).toISOString().slice(0, 10);
    const companies = this.all(`SELECT id, name, stage, tier, segment, fit_score, priority, source_channel, score_version, product_fit, city, state, address, latitude, longitude,
      stage_entered_at, close_reason FROM companies WHERE tier IS NOT NULL OR stage IS NOT NULL`);
    const coord = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const people = this.all(`SELECT p.id, p.first_name, p.last_name, p.title, p.relationship, p.email, p.linkedin_url, p.company_id
      FROM people p JOIN companies c ON c.id = p.company_id WHERE (c.tier IS NOT NULL OR c.stage IS NOT NULL)
      AND p.relationship IN ('Buyer','Connection')`);
    // Count imported contacts in SQL; only actual buyer/warm relationships need
    // individual rows in the browser. Never materialize the 3M purchased people.
    const peopleCounts = new Map(this.all('SELECT company_id,count(*) n FROM people GROUP BY company_id').map((p) => [p.company_id,p.n]));
    const purchasedScoring = {
      version: PRIORITY_VERSION,
      accounts: this.get(`SELECT count(*) total,
        sum(CASE WHEN score_version=? AND priority IS NOT NULL THEN 1 ELSE 0 END) scored,
        sum(CASE WHEN tier='A' THEN 1 ELSE 0 END) tier_a,
        sum(CASE WHEN tier='B' THEN 1 ELSE 0 END) tier_b,
        sum(CASE WHEN tier='C' THEN 1 ELSE 0 END) tier_c
        FROM companies WHERE source_channel='Purchased'`, PRIORITY_VERSION),
      contacts: this.get(`SELECT count(*) total,
        sum(CASE WHEN lead_score_version=? THEN 1 ELSE 0 END) evaluated,
        sum(CASE WHEN lead_score_version=? AND lead_score IS NOT NULL THEN 1 ELSE 0 END) scored,
        sum(CASE WHEN lead_score_version=? AND lead_score IS NULL THEN 1 ELSE 0 END) insufficient,
        sum(CASE WHEN lead_score_version=? AND lead_score_reason LIKE '%no fit score%' THEN 1 ELSE 0 END) missing_fit,
        sum(CASE WHEN lead_score_version=? AND trim(coalesce(title,''))='' THEN 1 ELSE 0 END) missing_title
        FROM people WHERE source='Purchased'`, ...Array(5).fill(PRIORITY_VERSION)),
    };
    const touches = new Map(this.all(`SELECT company_id, max(at) AS last_touch,
        max(CASE WHEN channel = 'In person' THEN at END) AS last_visit,
        sum(CASE WHEN channel = 'In person' THEN 1 ELSE 0 END) AS visits
      FROM activities WHERE type <> 'Stage change' AND company_id IS NOT NULL GROUP BY company_id`).map((r) => [r.company_id, r]));
    const openTasks = new Map(this.all(`SELECT company_id, count(*) AS open_tasks, min(due_date) AS next_due,
        sum(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue
      FROM tasks WHERE done_at IS NULL AND company_id IS NOT NULL GROUP BY company_id`, day).map((r) => [r.company_id, r]));
    const team = new Map();
    for (const p of people) {
      if (!team.has(p.company_id)) team.set(p.company_id, []);
      team.get(p.company_id).push(p);
    }
    const accounts = companies.map((c) => {
      const members = team.get(c.id) ?? [];
      const touch = touches.get(c.id) ?? {};
      const task = openTasks.get(c.id) ?? {};
      return {
        id: c.id, name: c.name, stage: c.stage, tier: c.tier, segment: c.segment, product_fit: c.product_fit,
        fit: c.fit_score == null || c.fit_score === '' ? null : Number(c.fit_score),
        priority: c.priority == null || c.priority === '' ? null : Number(c.priority),
        source: c.source_channel, score_version: c.score_version,
        city: c.city, state: c.state, area: visitArea(c), close_reason: c.close_reason, stage_entered_at: c.stage_entered_at,
        address: c.address, lat: coord(c.latitude), lng: coord(c.longitude),
        days_in_stage: c.stage && c.stage_entered_at
          ? Math.max(0, Math.round((dayMs - Date.parse(`${c.stage_entered_at.slice(0, 10)}T00:00:00Z`)) / 864e5)) : null,
        buyers: members.filter((p) => p.relationship === 'Buyer')
          .map((p) => ({ id: p.id, name: personName(p), title: p.title, role: roleGroup(p.title), reachable: !!(p.email || p.linkedin_url) })),
        connections: members.filter((p) => p.relationship === 'Connection').map((p) => ({ id: p.id, name: personName(p), title: p.title })),
        people: peopleCounts.get(c.id) ?? 0,
        open_tasks: task.open_tasks ?? 0, overdue_tasks: task.overdue ?? 0, next_due: task.next_due ?? null,
        last_touch: touch.last_touch ?? null, last_visit: touch.last_visit ?? null, visits: touch.visits ?? 0,
      };
    });

    // Weekly touches (weeks start Monday), last 12 weeks including this one.
    const weekOf = (iso) => {
      const d = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
      return new Date(d - ((new Date(d).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    };
    const thisWeek = Date.parse(`${weekOf(day)}T00:00:00Z`);
    const weekly = Array.from({ length: 12 }, (_, i) => ({
      week: new Date(thisWeek - (11 - i) * 7 * 864e5).toISOString().slice(0, 10),
      counts: Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, 0])),
    }));
    const weekIndex = new Map(weekly.map((w, i) => [w.week, i]));
    const recent = this.all("SELECT at, type, channel FROM activities WHERE type <> 'Stage change' AND at >= ?", daysAgo(120));
    for (const a of recent) {
      const slot = weekly[weekIndex.get(weekOf(localDate(a.at)))];
      if (slot && a.type in slot.counts) slot.counts[a.type]++;
    }
    const windowOf = (from, to) => {
      const rows = recent.filter((a) => localDate(a.at) >= from && localDate(a.at) <= to);
      return {
        touches: rows.length,
        outreach: rows.filter((a) => a.type === 'Outreach').length,
        replies: rows.filter((a) => a.type === 'Reply').length,
        meetings: rows.filter((a) => a.type === 'Meeting').length,
        booked: rows.filter((a) => a.type === 'Demo booked').length,
        demos: rows.filter((a) => a.type === 'Demo held').length,
        visits: rows.filter((a) => a.channel === 'In person').length,
      };
    };

    // Stage movements, parsed from the "From → To" stage-change log entries.
    const order = (label) => STAGES.findIndex((s) => s.label === label);
    const moves = new Map();
    const movement = { forward30: 0, back30: 0, closed30: 0 };
    for (const a of this.all("SELECT at, summary FROM activities WHERE type = 'Stage change' AND at >= ?", daysAgo(89))) {
      const [from, to] = String(a.summary ?? '').split(' → ');
      if (!to) continue;
      const key = `${from} → ${to}`;
      moves.set(key, { from, to, n: (moves.get(key)?.n ?? 0) + 1 });
      if (localDate(a.at) < daysAgo(29)) continue;
      const target = STAGES[order(to)]?.value;
      if (target === 'lost' || target === 'disqualified') movement.closed30++;
      else if (order(to) > order(from)) movement.forward30++;
      else movement.back30++;
    }

    return {
      today: day,
      accounts,
      purchased_scoring: purchasedScoring,
      weekly,
      windows: { last30: windowOf(daysAgo(29), day), prev30: windowOf(daysAgo(59), daysAgo(30)), last90: windowOf(daysAgo(89), day) },
      moves: { recent: [...moves.values()].sort((a, b) => b.n - a.n), ...movement },
      tasks: this.get('SELECT count(*) AS open, sum(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue FROM tasks WHERE done_at IS NULL', day),
    };
  }

  search(text) {
    if (!text || !String(text).trim()) return { companies: [], people: [] };
    const term = likeTerm(text);
    return {
      companies: this.all(`SELECT id, name, stage, website FROM companies WHERE name LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\'
        ORDER BY stage IS NULL, name COLLATE NOCASE LIMIT 6`, term, term),
      people: this.ftsMatch(text)
        ? this.all(`SELECT p.id, p.first_name, p.last_name, p.title, c.name AS company_name FROM people p
          LEFT JOIN companies c ON c.id = p.company_id
          WHERE p.seq IN (SELECT rowid FROM people_fts WHERE people_fts MATCH ?)
          ORDER BY p.last_name COLLATE NOCASE LIMIT 8`, this.ftsMatch(text))
        : this.all(`SELECT p.id, p.first_name, p.last_name, p.title, c.name AS company_name FROM people p
          LEFT JOIN companies c ON c.id = p.company_id
          WHERE (coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\'
          ORDER BY p.last_name COLLATE NOCASE LIMIT 8`, term, term),
    };
  }

  // ---- CSV import/export ----------------------------------------------------

  exportCsv(kind) {
    if (kind === 'activities') {
      const rows = this.all(`SELECT a.*, c.name AS company_name, p.first_name || ' ' || coalesce(p.last_name, '') AS person_name
        FROM activities a LEFT JOIN companies c ON c.id = a.company_id LEFT JOIN people p ON p.id = a.person_id ORDER BY a.at`);
      return toCsv(['id', 'at', 'type', 'channel', 'company_id', 'company_name', 'person_id', 'person_name', 'summary', 'body', 'created_at'], rows);
    }
    if (kind === 'tasks') {
      const rows = this.all(`SELECT t.*, c.name AS company_name FROM tasks t LEFT JOIN companies c ON c.id = t.company_id ORDER BY t.created_at`);
      return toCsv(['id', 'title', 'due_date', 'done_at', 'company_id', 'company_name', 'person_id', 'created_at', 'updated_at'], rows);
    }
    const def = this.entity(kind);
    const keys = def.fields.map((f) => f.key);
    if (kind === 'people') {
      const rows = this.all('SELECT p.*, c.name AS company_name FROM people p LEFT JOIN companies c ON c.id = p.company_id ORDER BY p.created_at');
      return toCsv(['id', ...keys, 'company_name', 'created_at', 'updated_at'], rows);
    }
    const rows = this.all('SELECT * FROM companies ORDER BY created_at');
    return toCsv(['id', ...keys, 'stage_entered_at', 'created_at', 'updated_at'], rows);
  }

  // Adds rows from CSV. Headers may be field keys or labels. A row matching an
  // existing company (same name) or person (same LinkedIn URL or email) fills in
  // that record's empty fields; it never overwrites a value.
  importCsv(kind, text) {
    const def = this.entity(kind);
    const rows = parseCsv(String(text ?? ''));
    if (!rows.length) throw new HttpError(400, 'The CSV has no data rows');
    if (rows.length > 20000) throw new HttpError(400, 'Import up to 20,000 rows at a time');
    const byHeader = new Map();
    for (const f of def.fields) {
      byHeader.set(f.key.toLowerCase(), f.key);
      // A "Company" column holds a name, not an ID; it is handled as company_name below.
      if (f.type !== 'company') byHeader.set(f.label.toLowerCase(), f.key);
    }
    const extra = kind === 'people'
      ? { company: 'company_name', company_name: 'company_name', 'company name': 'company_name', 'company website': 'company_website', name: 'full_name', 'full name': 'full_name' }
      : {};
    const unquote = (v) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
    const counts = { created: 0, updated: 0, skipped: 0 };
    const errors = [];
    this.transaction(() => {
      rows.forEach((raw, index) => {
        const input = {};
        for (const [header, value] of Object.entries(raw)) {
          const key = byHeader.get(header.trim().toLowerCase()) ?? extra[header.trim().toLowerCase()];
          if (key && value.trim() !== '') input[key] = unquote(value);
        }
        if (input.full_name && !input.first_name) {
          const parts = input.full_name.trim().split(/\s+/);
          input.first_name = parts.shift();
          input.last_name ??= parts.join(' ') || undefined;
        }
        delete input.full_name;
        try {
          const existing = this.findExisting(kind, input);
          if (!existing) {
            this.create(kind, input);
            counts.created++;
            return;
          }
          const values = this.clean(kind, input, { partial: true });
          const patch = Object.fromEntries(Object.entries(values).filter(([k, v]) => v != null && (existing[k] == null || existing[k] === '')));
          if (kind === 'people' && !existing.company_id && !patch.company_id && input.company_name) patch.company_name = input.company_name;
          if (Object.keys(patch).length) { this.update(kind, existing.id, patch); counts.updated++; } else counts.skipped++;
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          if (errors.length < 20) errors.push(`Row ${index + 2}: ${error.message}`);
        }
      });
    });
    return { ...counts, failed: rows.length - counts.created - counts.updated - counts.skipped, errors };
  }

  findExisting(kind, input) {
    if (kind === 'companies') return input.name ? this.get('SELECT * FROM companies WHERE name = ? COLLATE NOCASE', input.name.trim()) : null;
    const url = input.linkedin_url?.trim().replace(/\/+$/, '');
    return (url && this.get("SELECT * FROM people WHERE rtrim(linkedin_url, '/') = ? COLLATE NOCASE", url))
      || (input.email && this.get('SELECT * FROM people WHERE email = ? COLLATE NOCASE', input.email.trim()))
      || null;
  }

  // ---- Backups --------------------------------------------------------------

  backupTo(file) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) rmSync(file);
    this.db.prepare('VACUUM INTO ?').run(file);
    return file;
  }

  // Writes a backup into `directory` when the newest one is at least `everyDays` old
  // (daily by default) and keeps the newest `keep`.
  dailyBackup(directory, keep = 30, everyDays = 1) {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `crm-${now().slice(0, 10)}.sqlite`);
    const newest = readdirSync(directory).filter((f) => /^crm-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().pop();
    const age = newest ? (Date.parse(now().slice(0, 10)) - Date.parse(newest.slice(4, 14))) / 864e5 : Infinity;
    if (!existsSync(file) && age >= everyDays) this.backupTo(file);
    const backups = readdirSync(directory).filter((f) => /^crm-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - keep))) rmSync(join(directory, old));
    return file;
  }
}
