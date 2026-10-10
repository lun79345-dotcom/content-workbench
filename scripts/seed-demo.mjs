import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const schema = source.match(/const SCHEMA = `([\s\S]*?)`;/)?.[1];
if (!schema) throw new Error('Database schema not found');
const dir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(resolve(dir, 'app.db'));
db.exec('PRAGMA foreign_keys=ON;');
db.exec(schema);
for (const table of ['users', 'accounts', 'videos', 'ideas', 'students', 'metrics', 'bonuses', 'reviews', 'weekly', 'settings', 'notifications', 'targets', 'stage_log']) {
  if (db.prepare(`SELECT count(*) n FROM ${table}`).get().n) throw new Error('Refusing to overwrite an existing database. Use a separate empty DATA_DIR.');
}
const date = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
db.exec('BEGIN');
try {
  const people = [['老板演示', 'boss'], ['编导演示 A', 'editor'], ['编导演示 B', 'editor'], ['剪辑演示 A', 'cutter'], ['剪辑演示 B', 'cutter']];
  people.forEach(([name, role]) => db.prepare('INSERT INTO users(name,role) VALUES(?,?)').run(name, role));
  ['知识分享 · 示例','生活记录 · 示例','剧情创作 · 示例'].forEach((name, i) => db.prepare('INSERT INTO accounts(name,kind,new_since,editor_id,sort) VALUES(?,?,?,?,?)').run(name, i === 2 ? '剧情号' : '人设号', i === 2 ? date(-20) : null, i === 1 ? 3 : 2, i));
  db.prepare("INSERT INTO settings(key,value) VALUES('leader_id','2')").run();
  const stages = ['选题','脚本','脚本审核','拍摄','剪辑','成片审核','待发布','已发布'];
  const titles = ['如何整理一周灵感','三种常见的开场方式','把复杂问题讲明白','记录一次城市散步','一分钟讲清工作流程','人物访谈剪辑练习','轻量生活小技巧','示例：一次创作复盘'];
  stages.forEach((stage, i) => {
    db.prepare('INSERT INTO videos(code,title,account_id,editor_id,cutter_id,content_type,cut_level,extra_units,stage,due_script,due_shoot,due_rough,due_review,publish_date,published_at,brief,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      `V${String(i+1).padStart(3,'0')}`, titles[i], i%3+1, i%2 ? 3 : 2, i%2 ? 5 : 4, '演示内容','常规',0,stage,date(-2),date(0),date(1),date(2),date(3),i===7?date(-31):null,'虚构演示选题，用于体验流程；无真实客户或员工资料。',1);
  });
  [[3,'脚本审核',2,3],[6,'成片审核',5,3]].forEach(row => db.prepare('INSERT INTO reviews(video_id,node,submitter_id,reviewer_id) VALUES(?,?,?,?)').run(...row));
  for (const [cp, views] of [['d7',18000],['d30',40000]]) for (const platform of ['douyin','wechat']) db.prepare("INSERT INTO metrics(video_id,checkpoint,platform,plays,likes,comments,collects,shares,fans,source) VALUES(8,?,?,?,?,?,?,?,?, 'manual')").run(cp,platform,views,120,15,30,12,20);
  db.prepare('INSERT INTO targets(month,account_id,target_plays) VALUES(?,?,?)').run(date(0).slice(0,7),1,100000);
  db.prepare("INSERT INTO ideas(code,submitter_id,source,content,grade,status) VALUES('I001',2,'内部拆解','虚构创意：用日常场景解释一个小知识','A','入库')").run();
  db.prepare('INSERT INTO weekly(week,user_id,insight,next_plan) VALUES(?,?,?,?)').run('2026-W41',2,'演示复盘：先确认受众和一个明确主题。','演示计划：尝试两种开场并记录反馈。');
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
db.close();
console.log(`Fictitious demo data created at ${dir}. No real credentials, employees or platform data.`);
