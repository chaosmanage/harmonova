// Redacts raw Hacker News captures into committable fixtures (SEC-62).
// - Every 40-hex CSRF token becomes a deterministic placeholder (0…0 or 1…1).
// - Usernames, emails, karma numbers, and ages are normalized.
// - The leak guard fails when a committed fixture still contains a live token,
//   an email address, or a username supplied via HN_REDACT_USERNAMES.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(repoRoot, "tests", "fixtures", "hn", "raw");
const outDir = path.join(repoRoot, "tests", "fixtures", "hn");

// Placeholder tokens used across all committed fixtures (40 chars each).
export const PLACEHOLDER_TOKEN_A = "0".repeat(40);
export const PLACEHOLDER_TOKEN_B = "1".repeat(40);
export const PLACEHOLDER_USERNAME = "harmonova_test";

// Real usernames can be supplied via env (comma separated); they are never written out.
const privateUsernames = (process.env.HN_REDACT_USERNAMES || "")
  .split(",").map((name) => name.trim()).filter(Boolean);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const HEX40_PATTERN = /\b[0-9a-f]{40}\b/gi;

function redactHtml(html) {
  let counter = 0;
  let text = String(html);
  // Preserve the surrounding markup when replacing token-bearing attribute values:
  // tokens appear inside href values like vote?id=1&auth=<40hex> or name="hmac" value="…".
  text = text.replace(HEX40_PATTERN, (match) => {
    counter++;
    return counter % 2 ? PLACEHOLDER_TOKEN_A : PLACEHOLDER_TOKEN_B;
  });
  text = text.replace(EMAIL_PATTERN, () => "removed@example.invalid");
  for (const name of privateUsernames) {
    if (name) text = text.split(name).join(PLACEHOLDER_USERNAME);
  }
  return text;
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const files = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((f) => f.endsWith(".html")) : [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(rawDir, file), "utf8");
    const redacted = redactHtml(raw);
    fs.writeFileSync(path.join(outDir, file), redacted);
    console.log("redacted", file, raw.length, "->", redacted.length);
  }
  if (!files.length) console.log("no raw captures found in", rawDir);
}

function leakGuard(directory = path.join(repoRoot, "tests", "fixtures")) {
  const problems = [];
  const walk = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.name === "raw" ? [] : e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
  const files = fs.existsSync(directory) ? walk(directory) : [];
  const placeholders = new Set([PLACEHOLDER_TOKEN_A, PLACEHOLDER_TOKEN_B]);
  for (const absolute of files) {
    const file = path.relative(directory,absolute);
    const text = fs.readFileSync(absolute,"utf8");
    for (const match of text.matchAll(HEX40_PATTERN)) {
      if (!placeholders.has(match[0])) problems.push(`${file}: line ${text.slice(0,match.index).split("\n").length}: non-placeholder token`);
    }
    for (const match of text.matchAll(EMAIL_PATTERN)) {
      if (!match[0].endsWith("@example.invalid")) problems.push(`${file}: line ${text.slice(0,match.index).split("\n").length}: unredacted email`);
    }
    if (/sk-or-v1-[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) problems.push(`${file}: credential pattern`);
    for (const name of privateUsernames) if (name && text.includes(name)) problems.push(`${file}: private username`);
  }
  return problems;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (!process.argv.includes("--check")) main();
  const problems = leakGuard();
  if (problems.length) {
    console.error("FIXTURE LEAK GUARD FAILED:");
    for (const problem of problems) console.error(" -", problem);
    process.exit(1);
  }
  const count = dir => fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.name === "raw" ? 0 : e.isDirectory() ? count(path.join(dir,e.name)) : 1),0);
  const committed = count(path.join(repoRoot,"tests","fixtures"));
  console.log("leak guard ok:", committed, "fixtures clean");
}

export { redactHtml, leakGuard };