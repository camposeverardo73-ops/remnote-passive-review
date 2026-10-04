#!/bin/sh
set -eu

printf '%s\n' '[1/8] Clean install from lockfile'
npm ci --no-audit --no-fund

printf '%s\n' '[2/8] Static release audit'
npm run release:static

printf '%s\n' '[3/8] TypeScript check'
npm run check-types

printf '%s\n' '[4/8] Marketplace blockers'
node scripts/release-marketplace-gate.mjs

printf '%s\n' '[5/8] Production dependency security audit'
npm audit --omit=dev --audit-level=high

printf '%s\n' '[6/8] Official validator + production build'
npm run build

printf '%s\n' '[7/8] Artifact content audit'
if [ ! -f PluginZip.zip ]; then
  echo 'ERROR: PluginZip.zip was not produced' >&2
  exit 1
fi
if unzip -l PluginZip.zip | grep -E 'node_modules|\.env|\.DS_Store|/Users/|backup|logs?/|\.(pdf|jpg|jpeg|webp)$' >/dev/null 2>&1; then
  echo 'ERROR: release artifact contains a forbidden private/development file' >&2
  unzip -l PluginZip.zip
  exit 1
fi

printf '%s\n' '[8/8] Checksums and size'
shasum -a 256 PluginZip.zip
wc -c PluginZip.zip
printf '%s\n' 'RELEASE GATE PASS'
