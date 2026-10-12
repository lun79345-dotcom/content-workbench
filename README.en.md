# Content Workbench

A short-video operations workspace that connects ideas, scripts, approvals, filming, editing, publication, metrics, bonuses and weekly retrospectives around each video.

This independent public edition is **MIT licensed**. People, accounts, videos, metrics and compensation rules are fictitious. It excludes company credentials, employee records, production databases, internal deployment configuration and internal Git history.

[Portfolio](https://nickstudio.cn/en/content-workbench.html) · [中文](README.md) · [License](LICENSE)

## Run locally

Requires Node.js 22.13+ and npm. Basic demos need no Feishu account or paid API.

```sh
git clone https://github.com/lun79345-dotcom/content-workbench.git
cd content-workbench
npm ci
npm run seed:demo
npm run dev
```

Open http://127.0.0.1:3000 and choose a fictitious role. Development binds to localhost. The seed refuses to overwrite existing business data. Use a separate DATA_DIR for existing databases. Sample publication links use an invalid demo domain; all metrics are fictitious.

## Version 1.1

- Simpler briefs, account-owner defaults, publication-link recognition and manual scheduling.
- Eight production stages, rejection reasons, editing workload, requirement history and role-based access.
- Account weekly retrospectives with mature day-7 samples, completeness and hit-rate reporting; individual reviews remain available.
- Optional local Codex CLI worker creates structured AI drafts. Adoption and saving require human review.
- TikHub Douyin play statistics batch up to 50 videos, retain daily cumulative readings and suggest exact-date day-7/day-30 values for confirmation.
- Persistent daily request caps, retries and mutual exclusion. Defaults: 100 total requests and 10 play batches per day; 0 disables collection.
- Session expiry, logout revocation, concurrent-edit checks, audit records and locked bonus settlements.

WeChat Channels views remain manual: read_count has not been verified against creator-dashboard measurements. Current cumulative totals never backfill missing past checkpoints. AI uses workspace account data only; competitor benchmarks, retention and audience profiles are not included.

## Optional integrations

Configure your own values using .env.example. Feishu OAuth, pending-member approval and bot cards need your own enterprise app. BOSS_FEISHU_OPEN_IDS must contain verified identifiers from your tenant; display names never grant roles. TikHub requires your own key and incurs third-party charges.

For production, set a random SESSION_SECRET, disable demo login, use your own database and keep secure cookies on HTTPS. SQLite currently targets a single instance; multi-tenant and distributed deployments are not verified.

## Local AI worker

Start the app and use your own installed, signed-in Codex CLI. Create a JSON configuration with transport="local", an absolute dataDir for your database and an absolute codexPath. Then run:

```sh
npm run build:review-worker
ACCOUNT_REVIEW_CONFIG=/absolute/path/to/worker-config.json npm run review:worker
```

Generate from the account-review page. The computer must be awake and online. Manual reviews still work when the worker is offline. The prompt contains account names, video titles/types, publication dates and metrics; it excludes employee identities, compensation, internal briefs, publication URLs and integration secrets. Generation runs read-only in a temporary directory with output validation and job leases. Review drafts before adopting and saving.

Optional SSH transport and macOS launch scripts require your own deployment. The public service label is org.contentworkbench.account-review, independent of the internal project.

## Verification

```sh
npm test
npm run lint
npm run build
```

Tests use temporary SQLite databases and simulated interfaces; they do not call paid APIs or send real Feishu messages. 99 tests cover access control, workflow, data completeness, bonus locking, workload, account reviews, AI queues and collection budgets. Public screenshots show fictitious data and do not establish live integration results.

Source: src/app (pages/actions), src/lib (business/storage/integrations), scripts (demo/worker), tests and docs.

![Account retrospective · Fictitious demo](docs/account-weekly.png)

![Daily plays · Fictitious demo](docs/daily-plays.png)
