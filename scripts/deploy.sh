#!/usr/bin/env bash
# Example deploy of asobiba with its neighbour douga on one server (task 07).
# Both checkouts sit side by side: /srv/douga and /srv/asobiba. asobiba links
# @douga/* packages from ../douga/packages, so douga is pulled and installed first.
# Adjust the paths and the service manager to your server; this script does not
# provision anything and is safe to read before running.
set -euo pipefail

ROOT="${ROOT:-/srv}"
RESTART="${RESTART:-systemctl restart}"

echo "== douga =="
cd "$ROOT/douga"
git pull --ff-only
npm ci
npm run db:push
npm run build

echo "== asobiba =="
cd "$ROOT/asobiba"
git pull --ff-only
npm ci
npm run build

echo "== restart =="
$RESTART douga douga-worker asobiba
echo "done"
