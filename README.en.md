# Content Workbench

A short-video operations workspace connecting ideas, scheduling, script approval, filming, editing, final approval, publishing, metric entry, bonus settlement and weekly reviews.

This is a **public showcase copy** of an internal application. The internal version has been deployed with an enterprise Feishu app. The public copy has fresh Git history and excludes company credentials, employees, operational records and deployment configuration. All sample people, accounts, videos, metrics and bonus rules are fictitious.

[Portfolio case](https://nickstudio.cn/en/content-workbench.html) · [中文说明](README.md)

## Run locally

Requires Node.js **22.13+** with `node:sqlite`. No Feishu account or paid API is required.

```sh
git clone https://github.com/lun79345-dotcom/content-workbench.git
cd content-workbench
npm ci
npm run seed:demo
npm run dev
```

Visit <http://127.0.0.1:3000> and select a sample manager, writer or editor. The development server listens only on localhost. Seeding refuses to overwrite an existing database containing members or business data. Without the seed command, the app creates basic sample members and accounts but no videos.

Start with the manager dashboard and production board, then switch roles to inspect tasks, reviews, metric entry and bonuses. The role-based guide explains each flow. Demo identity selection is for local testing only.

## Features and boundaries

Eight production stages; owners and deadlines; script/final reviews and rejection reasons; change history; day-7/day-30 metrics; monthly account targets; weekly reviews; configurable bonus tiers and top-ups; locked published settlements and CSV export; idea evaluation; student submission consent.

Feishu OAuth, pending-member approval and bot cards are optional integrations requiring your own enterprise configuration. Douyin and WeChat **view counts are manually entered**. Optional TikHub calls assist with supported interaction metrics only and are skipped without a key. Sample data, shares and bonus amounts do not describe the company's real operations.

See `.env.example` for optional settings. For any external deployment, disable demo login, use a separate database and random session secret, disable sample identities, and configure your own Feishu application. Administrator bootstrap uses verified `BOSS_FEISHU_OPEN_IDS`; display names never bind a sample account or grant privileges. Public-copy integrations have not been tested against a real enterprise tenant.

```sh
npm run lint
npm test
npm run build
```

Tests cover complete platform metrics, bonus top-ups, repeated calculation and published settlement locking. Production mode requires `SESSION_SECRET` and disables demo login by default. SQLite currently targets a single-instance showcase; distributed deployments and multi-tenant isolation have not been validated.

Built with Next.js 15, React 19, TypeScript, Tailwind CSS 4 and SQLite. Source is published for portfolio review without an open-source license. Contact the author before commercial reuse.

![Production board / 虚构演示看板](docs/board.png)
