# Install

## Prerequisites

- .NET 8 SDK
- Node 18+ and npm
- Access to the PostgreSQL database

## API

```bash
cd D:\commission_v2\api\Commission.Api

# Option A: set env var
$env:DATABASE_URL = "Host=10.20.53.10;Port=5432;Database=nfpcproduct;Username=choithram;Password=choithram"

# Option B: edit appsettings.json -> ConnectionStrings:Default

dotnet run
# Listens on http://localhost:5000 (and https://localhost:5001 if certs exist)
# Bootstrap creates any missing tables idempotently at startup.
```

Verify:
```bash
curl http://localhost:5000/api/health
# { "status": "ok", "timestamp": "..." }
```

Swagger UI: `http://localhost:5000/swagger` (dev only).

## Web

```bash
cd D:\commission_v2\web
copy .env.local.example .env.local
# Edit .env.local if API runs anywhere other than http://localhost:5000

npm run dev
# Listens on http://localhost:3000 → redirects to /dashboard
```

## Smoke test

1. Open `http://localhost:3000`.
2. Dashboard shows counts (Plans/KPIs/Employees) — empty initially.
3. Plans page → "New Plan" → fill basic info → submit.
4. Calculate page → pick an active plan → 600ms after, calculation auto-fires.
5. Expand a row in the result table → drill into per-KPI payout breakdown.

## Troubleshooting

- **`DATABASE_URL not set`** — set the env var or the appsettings.json connection string.
- **Schema bootstrap failures logged at startup** — pass-through; the server starts anyway and existing tables are reused. Check the log for the failing statement.
- **CORS errors in the browser** — the API already enables `AllowAnyOrigin`. If you front it with a reverse proxy, mirror those headers.
