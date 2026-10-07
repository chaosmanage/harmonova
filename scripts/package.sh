#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(node -p "JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version")"
name="harmonic-hn-browser-$version"
out="dist/$name"

rm -rf dist
mkdir -p "$out"

cp manifest.json content.js styles.css background.js README.md LICENSE "$out/"

(
  cd dist
  zip -qr "$name.zip" "$name"
)

printf 'Created dist/%s.zip\n' "$name"
