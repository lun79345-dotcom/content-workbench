// Private transport over SSH/docker exec. Never expose this as a public HTTP endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { claimAccountReview, heartbeatReviewWorker, finishAccountReview, failAccountReview } from '../.account-review-worker/account-review-queue.mjs';
let body = '';
for await (const part of process.stdin) {
  body += part;
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('Request too large');
}
const input = JSON.parse(body);
const file = path.join(process.env.DATA_DIR || '/data', 'app.db');
if (!fs.existsSync(file)) throw new Error('Application DB is unavailable');
const d = new DatabaseSync(file);
d.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
try {
  let result;
  if (input.action === 'claim') result = claimAccountReview(d);
  else if (input.action === 'heartbeat') { heartbeatReviewWorker(d); result = true; }
  else if (['finish', 'fail'].includes(input.action) && Number.isSafeInteger(input.id) && typeof input.lease === 'string') {
    result = input.action === 'finish' ? finishAccountReview(d, input.id, input.lease, input.report) : failAccountReview(d, input.id, input.lease, input.code);
  } else throw new Error('Unknown request');
  process.stdout.write(JSON.stringify(result));
} finally { d.close(); }
