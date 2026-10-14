// Browser-only SQLite adapter. It has no server or filesystem access.
const SQL = globalThis.GOAI_DEMO_SQL ?? await globalThis.initSqlJs({
  locateFile: (file) => new URL(`../vendor/sqljs/${file}`, import.meta.url).href,
});
export const STORAGE_KEY = 'goai-fictional-demo-v1';
const readSnapshot = () => {
  try {
    const encoded = sessionStorage.getItem(STORAGE_KEY);
    return encoded ? Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)) : undefined;
  } catch { return undefined; }
};
export class DatabaseSync {
  constructor() { this.raw = new SQL.Database(readSnapshot()); }
  exec(sql) { this.raw.run(sql); }
  prepare(sql) {
    const raw = this.raw;
    const query = (params, one = false) => {
      const stmt = raw.prepare(sql);
      try {
        stmt.bind(params.map((v) => v ?? null));
        const rows = [];
        while (stmt.step()) { rows.push(stmt.getAsObject()); if (one) break; }
        return one ? rows[0] : rows;
      } finally { stmt.free(); }
    };
    return {
      all: (...params) => query(params), get: (...params) => query(params, true),
      iterate: (...params) => query(params)[Symbol.iterator](),
      run: (...params) => {
        raw.run(sql, params.map((v) => v ?? null));
        return { changes: raw.getRowsModified() };
      },
    };
  }
  save() {
    try {
      const bytes = this.raw.export();
      let text = '';
      for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i,i+8192));
      sessionStorage.setItem(STORAGE_KEY,btoa(text));
      this.exec('PRAGMA foreign_keys=ON');
    } catch { /* A browser blocking storage still has a working in-memory demo. */ }
  }
  close() { this.raw.close(); }
}
export const randomUUID = () => crypto.randomUUID();
export const mkdirSync = () => {};
export const existsSync = () => false;
export const readdirSync = () => [];
export const rmSync = () => { throw new Error('Server files are not available in demo mode'); };
export const dirname = () => '';
export const join = (...parts) => parts.join('/');
