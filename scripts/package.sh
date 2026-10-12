#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(node -p "JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version")"
folder="harmonova"
out="dist/$folder"
tmp="dist/.${folder}-build"
zip_path="dist/${folder}-${version}.zip"

mkdir -p dist
rm -rf "$tmp"
mkdir -p "$tmp/icons" "$tmp/docs/assets" "$tmp/fonts"

mkdir -p "$tmp/content"
mkdir -p "$tmp/worker"
cp manifest.json content.js styles.css background.js url-policy.js message-boundary.js ai-policy.js reader-store.js settings-schema.js preferences-store.js resource-policy.js image-policy.js provider-policy.js lifecycle.js hn-queue.js hn-session.js hn-search.js incognito-state.js popup.html popup.css popup.js ai-settings.html ai-settings.css ai-settings.js README.md CHANGELOG.md LICENSE "$tmp/"
cp content/state.js "$tmp/content/"
cp worker/storage.js "$tmp/worker/"
cp worker/ai.js "$tmp/worker/"
cp worker/network.js "$tmp/worker/"
cp worker/messages.js "$tmp/worker/"
cp content/composer.js "$tmp/content/"
cp content/settings.js "$tmp/content/"
cp content/summary-ui.js "$tmp/content/"
cp content/previews.js "$tmp/content/"
cp content/search-ui.js "$tmp/content/"
cp content/comments.js "$tmp/content/"
cp content/feed.js "$tmp/content/"
cp content/reader.js "$tmp/content/"
cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png icons/harmonova-icon.png icons/README.md "$tmp/icons/"
cp fonts/GoogleSansFlexRounded-wght.ttf fonts/GoogleSansFlexRounded-Italic-wght.ttf fonts/OFL.txt "$tmp/fonts/"
cp docs/*.md "$tmp/docs/"
cp docs/assets/*.png "$tmp/docs/assets/"

rm -rf "$out"
mv "$tmp" "$out"
rm -f dist/${folder}-*.zip
(
  cd dist
  zip -qr "${folder}-${version}.zip" "$folder"
)

printf 'Created %s and %s\n' "$out" "$zip_path"
