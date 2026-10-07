#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(node -p "JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version")"
folder="harmonic-hn-browser"
out="dist/$folder"
tmp="dist/.${folder}-build"
zip_path="dist/${folder}-${version}.zip"

mkdir -p dist
rm -rf "$tmp"
mkdir -p "$tmp/icons"

cp manifest.json content.js styles.css background.js popup.html popup.css popup.js README.md CHANGELOG.md LICENSE "$tmp/"
cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png "$tmp/icons/"

rm -rf "$out"
mv "$tmp" "$out"
rm -f dist/${folder}-*.zip
(
  cd dist
  zip -qr "${folder}-${version}.zip" "$folder"
)

printf 'Created %s and %s\n' "$out" "$zip_path"
