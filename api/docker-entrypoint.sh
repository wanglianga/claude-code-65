#!/bin/sh
set -e
echo "[entrypoint] syncing database schema..."
npx prisma db push --skip-generate
echo "[entrypoint] seeding demo data (idempotent)..."
node prisma/seed.js
echo "[entrypoint] starting api..."
exec node dist/main.js
