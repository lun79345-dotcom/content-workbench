import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '..');
const nativeRequire = createRequire(import.meta.url);
/** Load real TS modules with only Next request context / transport replaced. Each fixture owns its DB. */
export function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yunying-test-'));
  const original = { ...process.env };
  process.env.DATA_DIR = directory;
  process.env.FEISHU_APP_ID = '';
  process.env.FEISHU_APP_SECRET = '';
  delete process.env.BOSS_FEISHU_OPEN_IDS;
  const state = { me: null, notices: [] };
  const mocks = {
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect(location) { const e = new Error(`redirect:${location}`); e.redirect = location; throw e; } },
    '@/lib/auth': { requireUser: async () => state.me, requireBoss: async () => { if (state.me.role !== 'boss') throw new Error('无权限'); return state.me; } },
    '@/lib/notify': { notify: async (...args) => state.notices.push(args) },
    ...options.mocks,
  };
  const cache = new Map();
  function load(name, parent = path.join(root, 'src', 'index.ts')) {
    if (name in mocks) return mocks[name];
    let target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name.startsWith('.') ? path.resolve(path.dirname(parent), name) : null;
    if (!target) return nativeRequire(name);
    if (!path.extname(target)) target += '.ts';
    if (cache.has(target)) return cache.get(target).exports;
    const loaded = { exports: {} }; cache.set(target, loaded);
    const code = ts.transpileModule(fs.readFileSync(target, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const execute = vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${code}\n})`, { filename: target });
    execute((next) => load(next, target), loaded, loaded.exports, target, path.dirname(target));
    return loaded.exports;
  }
  const db = load('@/lib/db');
  const d = db.db();
  d.exec(`DELETE FROM accounts; DELETE FROM settings; DELETE FROM users;
    INSERT INTO users(id,name,role,feishu_open_id) VALUES(1,'老板','boss','boss'),(2,'编导','editor','editor'),(3,'剪辑','cutter','cut'),(4,'其他剪辑','cutter','other'),(5,'组长','editor','leader');
    INSERT INTO accounts(id,name,kind) VALUES(1,'账号','人设号');
    INSERT INTO settings(key,value) VALUES('leader_id','5');`);
  state.me = d.prepare('SELECT * FROM users WHERE id=1').get();
  return { ...db, d, directory, load, state,
    as(uid) { state.me = d.prepare('SELECT * FROM users WHERE id=?').get(uid); },
    close() { d.close(); fs.rmSync(directory, { recursive: true, force: true }); for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); },
    video(fields = {}) {
      const defaults = { title: '测试视频', account_id: 1, editor_id: 2, cutter_id: 3, stage: '剪辑', cut_level: '常规', extra_units: 0, due_rough: '2026-10-12', code: `V${d.prepare('SELECT count(*) n FROM videos').get().n + 1}` };
      const v = { ...defaults, ...fields }, keys = Object.keys(v);
      return Number(d.prepare(`INSERT INTO videos(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(v)).lastInsertRowid);
    },
  };
}
export function form(values) { const fd = new FormData(); for (const [k, v] of Object.entries(values)) fd.set(k, String(v ?? '')); return fd; }
export function videoForm(f, values) {
  return form({ revision: f.get('SELECT * FROM videos WHERE id=?', values.id)?.revision ?? 0, ...values });
}
