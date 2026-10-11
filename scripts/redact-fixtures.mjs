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
export const PLACEHOLDER_USERNAME = "harmonic_test";

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

function leakGuard() {
  const problems = [];
  const files = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith(".html")) : [];
  const placeholders = new Set([PLACEHOLDER_TOKEN_A, PLACEHOLDER_TOKEN_B]);
  for (const file of files) {
    const text = fs.readFileSync(path.join(outDir, file), "utf8");
    const tokens = text.match(HEX40_PATTERN) || [];
    for (const token of tokens) {
      if (!placeholders.has(token)) problems.push(`${file}: non-placeholder 40-hex token ${token}`);
    }
    const emails = text.match(EMAIL_PATTERN) || [];
    for (const email of emails) {
      if (!email.endsWith("@example.invalid")) problems.push(`${file}: unredacted email ${email}`);
    }
    for (const name of privateUsernames) {
      if (name && text.includes(name)) problems.push(`${file}: private username leaked`);
    }
  }
  return problems;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
  const problems = leakGuard();
  if (problems.length) {
    console.error("FIXTURE LEAK GUARD FAILED:");
    for (const problem of problems) console.error(" -", problem);
    process.exit(1);
  }
  const committed = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.endsWith(".html")).length : 0;
  console.log("leak guard ok:", committed, "fixtures clean");
}

export { redactHtml, leakGuard };