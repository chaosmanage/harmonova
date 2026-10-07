#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json")"
OUT="$ROOT/dist/harmonic-hn-$VERSION.zip"

mkdir -p "$ROOT/dist"
rm -f "$OUT"

cd "$ROOT"
zip -q "$OUT" manifest.json content.js background.js styles.css README.md LICENSE
printf 'Created %s\n' "$OUT"
