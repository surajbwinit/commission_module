#!/bin/bash
# ---------------------------------------------------------------------------
# Build a standalone, distributable Next.js bundle for the Commission web app.
#
# Why this script exists separately from `npm run build`:
#   `NEXT_PUBLIC_*` env vars are inlined into the browser bundle at BUILD time,
#   not read at runtime. So copying a .env file into the dist folder AFTER the
#   build does NOT change the API URL the browser will call. The URL has to be
#   set BEFORE `next build` runs.
#
# Usage:
#   ./build-standalone.sh https://commission-dev-api.winitsoftware.com/api
#   API_BASE=https://commission-dev-api.winitsoftware.com/api ./build-standalone.sh
#   ./build-standalone.sh           # falls back to .env.production then localhost
# ---------------------------------------------------------------------------
set -e

# 1. Resolve the API base URL ------------------------------------------------
API_BASE="${1:-${API_BASE:-${NEXT_PUBLIC_API_BASE:-}}}"
if [ -z "$API_BASE" ] && [ -f .env.production ]; then
  API_BASE=$(grep -E '^NEXT_PUBLIC_API_BASE=' .env.production | head -1 | cut -d= -f2- | tr -d '\r"')
fi
if [ -z "$API_BASE" ]; then
  echo "⚠️  No API URL provided — defaulting to http://localhost:5000/api"
  echo "    Pass one as the first arg, e.g.:"
  echo "    ./build-standalone.sh https://commission-dev-api.winitsoftware.com/api"
  API_BASE="http://localhost:5000/api"
fi

echo "🚀 Building standalone Next.js bundle"
echo "🔗 NEXT_PUBLIC_API_BASE = $API_BASE   (baked into the browser bundle)"

# 2. Clean previous builds ---------------------------------------------------
rm -rf .next dist-standalone

# 3. Build the application ---------------------------------------------------
echo "📦 Running next build..."
export NEXT_PUBLIC_API_BASE="$API_BASE"
export NODE_OPTIONS='--max-old-space-size=6144'
npx next build

if [ ! -d ".next/standalone" ]; then
  echo "❌ .next/standalone missing. Confirm next.config.mjs has  output: 'standalone'"
  exit 1
fi

# 4. Assemble the distribution -----------------------------------------------
echo "📁 Assembling dist-standalone/..."
mkdir -p dist-standalone

# Find the inner app dir (the one with server.js, not under node_modules)
STANDALONE_APP_DIR=$(find .next/standalone -name "server.js" -type f ! -path "*/node_modules/*" -exec dirname {} \; | head -1)
if [ -z "$STANDALONE_APP_DIR" ]; then
  echo "❌ Could not locate server.js in .next/standalone"
  exit 1
fi
echo "📋 Source app: $STANDALONE_APP_DIR"

cp -r "$STANDALONE_APP_DIR"/* dist-standalone/ 2>/dev/null || true
cp -r "$STANDALONE_APP_DIR"/.[^.]* dist-standalone/ 2>/dev/null || true

if [ -d "public" ]; then
  cp -r public dist-standalone/
fi
if [ -d ".next/static" ]; then
  mkdir -p dist-standalone/.next/static
  cp -r .next/static dist-standalone/.next/
fi

# 5. Write the .env that the SERVER (not the browser) will read --------------
# Only server-side knobs go here. The API URL is already inside the bundle.
cat > dist-standalone/.env <<EOF
# Server-side configuration only. Editing NEXT_PUBLIC_* values here has NO
# effect on the browser bundle — those were inlined at build time. To change
# the API URL, rebuild with:
#   ./build-standalone.sh <new-api-url>
PORT=3000
NODE_ENV=production
EOF

cat > dist-standalone/.env.example <<EOF
# Server-side knobs
PORT=3000
NODE_ENV=production
# NOTE: NEXT_PUBLIC_API_BASE was baked in at build time = $API_BASE
EOF

# 6. Start scripts -----------------------------------------------------------
cat > dist-standalone/start.sh <<'EOF'
#!/bin/bash
echo "🚀 Starting Commission web app..."
PORT=${PORT:-3000}
NODE_ENV=production node server.js
EOF
chmod +x dist-standalone/start.sh

cat > dist-standalone/start.bat <<'EOF'
@echo off
echo Starting Commission web app...
set NODE_ENV=production
if "%PORT%"=="" set PORT=3000
node server.js
pause
EOF

# 7. README ------------------------------------------------------------------
cat > dist-standalone/README.md <<EOF
# Commission Web — Production Build

API baked in at build time: \`$API_BASE\`

## Run
\`\`\`bash
./start.sh      # Linux / macOS
start.bat       # Windows
\`\`\`

Then open http://localhost:3000

## Change the API URL
The API URL is compiled into the browser bundle. Editing the \`.env\` file
will NOT change it. To switch endpoints, rebuild:
\`\`\`bash
./build-standalone.sh https://my-new-api.example.com/api
\`\`\`

## Requirements
- Node.js 18+
- Port 3000 free (or set \`PORT\` in \`.env\`)
EOF

echo ""
echo "✅ Build complete"
echo "📁 dist-standalone/   API → $API_BASE"
echo ""
echo "Next:"
echo "  cd dist-standalone && ./start.sh       (or start.bat on Windows)"
echo "  Open http://localhost:3000"
