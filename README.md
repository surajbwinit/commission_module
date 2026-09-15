# Commission v2 — Next.js + .NET 8

Tech-stack rewrite of the commission engine.

- **api/** — ASP.NET Core 8 Web API. Raw SQL via Dapper/Npgsql. **No Entity Framework.**
- **web/** — Next.js 14 (App Router, TS, Tailwind).
- Same PostgreSQL database/schema as the original Node.js system.

## Architecture (unchanged from the JS version — only the language changes)

```
┌──────────────────────┐   axios   ┌──────────────────────┐
│  Next.js SPA         │  ─────►   │  ASP.NET Core 8 API  │
│  (App Router, TS)    │           │  Controllers         │
│  port 3000           │           │  Calc Engine (13 steps)
└──────────────────────┘           │  Dapper + Npgsql     │
                                   └──────────┬───────────┘
                                              │ raw SQL
                                              ▼
                                   ┌──────────────────────┐
                                   │  PostgreSQL          │
                                   │  (existing schema)   │
                                   └──────────────────────┘
```

## Quick start

### 1. Database

Point at the existing commission PostgreSQL. The API will create any missing tables idempotently at first start via `Sql/schema.sql`.

Set `DATABASE_URL` (env var) **or** `api/Commission.Api/appsettings.json :: ConnectionStrings:Default`.

Example:
```
Host=10.20.53.10;Port=5432;Database=nfpcproduct;Username=choithram;Password=choithram
```

### 2. Run the API

```bash
cd api/Commission.Api
dotnet run
```

Default port: `http://localhost:5000` (or `5001` for HTTPS). Swagger at `/swagger`.

### 3. Run the web

```bash
cd web
cp .env.local.example .env.local       # set NEXT_PUBLIC_API_BASE if needed
npm install                            # already done
npm run dev
```

Default: `http://localhost:3000` → redirects to `/dashboard`.

## What's ported

All 13 calculation-pipeline steps + the formula evaluator + the eligibility / rule engines are 1:1 ports of the JS code. The schema, table names, and column names are identical (no `cm_` prefix, no view layer — same DB).

| Concept | Original (JS) | New (C#) |
|---|---|---|
| Pipeline orchestrator | `server/src/engine/calculationPipeline.js` | `api/Commission.Api/Engine/CalculationPipeline.cs` |
| Formula evaluator | `server/src/engine/formulaEvaluator.js` | `api/Commission.Api/Engine/FormulaEvaluator.cs` |
| Eligibility engine | `server/src/engine/eligibilityEngine.js` | `api/Commission.Api/Engine/EligibilityEngine.cs` |
| Mapping filters | `server/src/engine/step02_mappingFilters.js` | `api/Commission.Api/Engine/MappingFilters.cs` |
| Steps 1-12 | `server/src/engine/step*.js` | `api/Commission.Api/Engine/Steps.cs` |
| DB shim | `server/src/db/database.js` | `api/Commission.Api/Data/Db.cs` |
| Schema DDL | `server/src/db/schema.js` | `api/Commission.Api/Sql/schema.sql` |
| 22 routes | `server/src/routes/*.js` | `api/Commission.Api/Controllers/*.cs` |
| 10 pages | `client/src/pages/*.jsx` | `web/src/app/**/page.tsx` |

## API surface (mirrors the JS API exactly)

```
GET  /api/health                              health check
GET  /api/plans                               list plans
GET  /api/plans/:id                           plan with all sections
POST /api/plans                               create plan
PUT  /api/plans/:id                           update plan header
PUT  /api/plans/:id/roles                     replace plan roles
PUT  /api/plans/:id/territories               replace plan territories
PUT  /api/plans/:id/kpis                      replace plan KPIs
PUT  /api/plans/:id/slabs                     replace slab sets
PUT  /api/plans/:id/rules                     replace include/exclude rules
PUT  /api/plans/:id/eligibility               replace eligibility rules
PUT  /api/plans/:id/multipliers               replace multiplier rules
PUT  /api/plans/:id/kpi-deductions            replace KPI deduction rules
PUT  /api/plans/:id/penalties                 replace penalty rules
PUT  /api/plans/:id/caps                      replace cap rules
PUT  /api/plans/:id/splits                    replace split rules
PUT  /api/plans/:id/monthly-targets           replace monthly targets
PUT  /api/plans/:id/fixed-incentives          replace fixed incentives

GET  /api/kpis                                list KPI definitions
POST /api/kpis                                create KPI
PUT  /api/kpis/:id                            update KPI
DELETE /api/kpis/:id                          soft-delete KPI

POST /api/calculation/run                     run pipeline
GET  /api/calculation/runs                    list runs
GET  /api/calculation/runs/:id                run + payouts
GET  /api/calculation/payouts/:id             payout + KPI breakdown
POST /api/simulation/run                      what-if (is_simulation=true)

GET  /api/approvals                           pending payouts
POST /api/approvals/:payoutId/action          submit approval action
GET  /api/audit                               audit trail
GET  /api/dashboard/summary                   dashboard cards
GET  /api/dashboard/top-performers            top-N payouts
GET  /api/employees                           employees
GET  /api/roles                               roles
GET  /api/territories                         territories
GET  /api/products                            products
GET  /api/customers                           customers
GET  /api/transactions                        transactions
GET  /api/lookups/filter-values               FormulaBuilder lookups
GET  /api/tags                                tags
GET  /api/currencies                          currencies
GET  /api/events                              commission events
GET  /api/trips                               trips
GET  /api/perfect-store                       audits
GET  /api/rules/plan/:planId                  plan rule bundle
POST /api/bulk/transactions                   bulk import
GET  /api/slabs                               slab sets
```

## Files of interest

- `api/Commission.Api/Engine/CalculationPipeline.cs` — the 13-step orchestrator.
- `api/Commission.Api/Engine/FormulaEvaluator.cs` — 5 formula types (simple/ratio/growth/team/static) + in-memory aggregation + DB-side prev-period queries for growth/team.
- `api/Commission.Api/Engine/Steps.cs` — all 12 step functions as static helpers.
- `api/Commission.Api/Sql/schema.sql` — 41 tables, indexes, FKs.
- `web/src/app/calculate/page.tsx` — auto-fires calculation 600ms after selection change (matches the JS UX).
- `web/src/app/plans/[id]/page.tsx` — 13-tab Plan Builder.

## What's not yet ported

Some niceties from the original JS that need iteration to reach full parity:
- Some advanced PlanBuilder editing flows — minor tabs may still be API-only.

These are scoped lift work — happy to add them in follow-up passes.