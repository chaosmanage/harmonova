// Builds synthetic logged-in fixtures from the redacted logged-out captures.
//
// HarmoNova has no Hacker News credentials available in this environment, so
// logged-in fixtures are SYNTHETIC: they are derived from real logged-out
// captures and carry placeholder tokens (0*40 / 1*40) and the placeholder
// username `harmonova_test`. They exist to exercise parsers and mocked flows;
// verify authenticated behavior separately with an authorized, interactive
// Hacker News session; do not commit real credentials or action tokens.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hn");
const outDir = path.join(fixtureDir, "synthetic");
fs.mkdirSync(outDir, { recursive: true });

const TA = "0".repeat(40); // token placeholder A
const TB = "1".repeat(40); // token placeholder B
const USER = "harmonova_test";

const read = (name) => fs.readFileSync(path.join(fixtureDir, name), "utf8");
const write = (name, html) => {
  fs.writeFileSync(path.join(outDir, name), html);
  console.log("built", name, html.length, "bytes");
};

function loggedInTopbar(goto) {
  return `<span class="pagetop"><a id="me" href="user?id=${USER}">${USER}</a>&nbsp;(<span id="karma">512</span>)&#32;|&#32;<a id="logout" href="logout?auth=${TB}&amp;goto=${goto}">logout</a></span>`;
}

// Logged-in topbar replacing the logged-out login link (keeps the goto target).
function injectTopbar(html, goto) {
  return html.replace(
    /<span class="pagetop"><a href="login\?goto=([^"]*)">login<\/a><\/span>/,
    () => loggedInTopbar(goto)
  );
}

// Add auth parameters to every vote and hide link.
function injectAuth(html) {
  return html
    .replace(/(vote\?id=(\d+)&amp;how=(up|down))&amp;goto=/g, `$1&amp;auth=${TA}&amp;goto=`)
    .replace(/(hide\?id=(\d+))&amp;goto=/g, `$1&amp;auth=${TB}&amp;goto=`);
}

// HN renders the unvote link inside the unv_ID span beside the score;
// it never puts an arrow inside un_ID (the old fixtures invented one).
function markVoted(html, itemId, direction = "up") {
  const upPattern = new RegExp(
    `<a id="up_${itemId}" href="vote\\?id=${itemId}&amp;how=up&amp;auth=${TA}&amp;goto=([^"]*)"><div class="votearrow" title="upvote"><\\/div><\\/a>`
  );
  const match = html.match(upPattern);
  if (!match) return html;
  const goto = match[1];
  html = html.replace(upPattern, `<a id="up_${itemId}" class="nosee" href="vote?id=${itemId}&amp;how=up&amp;auth=${TA}&amp;goto=${goto}"><div class="votearrow" title="upvote"></div></a>`);
  const unvote = `<span id="unv_${itemId}"> | <a id="un_${itemId}" class="clicky" href="vote?id=${itemId}&amp;how=un&amp;auth=${TA}&amp;goto=${goto}">${direction === "down" ? "undown" : "unvote"}</a></span>`;
  return html.replace(`<span id="unv_${itemId}"></span>`, unvote);
}

// ---------------------------------------------------------------------------
// 1. Logged-in news feed
// ---------------------------------------------------------------------------

const news = read("news.html");
let newsIn = injectTopbar(news, "news");
newsIn = injectAuth(newsIn);
// Mark the second story on the feed as upvoted.
const secondStory = [...news.matchAll(/<tr class="athing submission" id="(\d+)">/g)][1]?.[1];
if (secondStory) newsIn = markVoted(newsIn, secondStory, "up");
write("news-in.html", newsIn);

// ---------------------------------------------------------------------------
// 2. Logged-in item page (fresh thread with a comment form)
// ---------------------------------------------------------------------------

const STORY_ID = 50022292; // the captured fresh thread (Triple-A Minesweeper)
const item = read("item-fresh.html");
let itemIn = injectTopbar(item, "item%3Fid%3D" + STORY_ID);
itemIn = injectAuth(itemIn);

// Story: voted up; flag link injected (item pages already carry fave/hide links
// with tokens even when logged out — verified against the live capture).
itemIn = markVoted(itemIn, STORY_ID, "up");
itemIn = itemIn.replace(
  `<a href="hide?id=${STORY_ID}&amp;auth=${TB}&amp;goto=item%3Fid%3D${STORY_ID}">hide</a>`,
  `<a href="hide?id=${STORY_ID}&amp;auth=${TB}&amp;goto=item%3Fid%3D${STORY_ID}">hide</a> | <a href="flag?id=${STORY_ID}&amp;auth=${TB}">flag</a>`
);

// Comments: give every comment navs a favorite + reply link; first comment
// gets the active (unfavorite) state and a voted-up (un) arrow.
const firstCommentId = Number(itemIn.match(/<a class="togg clicky" id="(\d+)"/)?.[1] || 0);
let firstCommentDone = false;
itemIn = itemIn.replace(/<span class="navs">([\s\S]{0,400}?)<\/span><\/span>/g, (match, inner) => {
  const togg = inner.match(/<a class="togg clicky" id="(\d+)"/);
  if (!togg) return match;
  const cid = togg[1];
  const favorite = !firstCommentDone
    ? `<a href="fave?id=${cid}&amp;auth=${TA}&amp;un=t">unfavorite</a>`
    : `<a href="fave?id=${cid}&amp;auth=${TA}">favorite</a>`;
  firstCommentDone = true;
  const reply = `<a href="reply?id=${cid}&amp;goto=item%3Fid%3D${STORY_ID}">reply</a>`;
  return `<span class="navs">` + inner + ` | ${favorite} | ${reply}</span></span>`;
});
if (firstCommentId) itemIn = markVoted(itemIn, firstCommentId, "up");
write("item-in.html", itemIn);

// ---------------------------------------------------------------------------
// 3. Minimal logged-in pages: reply, edit, delete-confirm, submit, errors
// ---------------------------------------------------------------------------

const pageShell = (title, body, goto = "item%3Fid%3D" + STORY_ID) => `<!doctype html><html lang="en" op="item"><head><meta name="referrer" content="origin"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="icon" href="y18.svg"><title>${title}</title></head><body><center><table id="hnmain" border="0" cellpadding="0" cellspacing="0" width="85%" bgcolor="#f6f6ef"><tr><td bgcolor="#ff6600"><table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding:2px"><tr><td style="width:18px;padding-right:4px"><a href="https://news.ycombinator.com"><img src="y18.svg" width="18" height="18" style="border:1px white solid; display:block"></a></td><td style="line-height:12pt; height:10px;"><span class="pagetop"><b class="hnname"><a href="news">Hacker News</a></b><a href="newest">new</a> | <a href="front">past</a> | <a href="newcomments">comments</a> | <a href="ask">ask</a> | <a href="show">show</a> | <a href="jobs">jobs</a> | <a href="submit" rel="nofollow">submit</a></span></td><td style="text-align:right;padding-right:4px;">${loggedInTopbar(goto)}</td></tr></table></td></tr><tr><td style="padding:10px">${body}</td></tr></table></center></body></html>`;

const CID = 50033557; // placeholder comment id used in form fixtures

write("reply-in.html", pageShell("Add Comment",
  `<form action="comment" method="post">`
  + `<input type="hidden" name="parent" value="${CID}">`
  + `<input type="hidden" name="goto" value="item%3Fid%3D${STORY_ID}">`
  + `<input type="hidden" name="hmac" value="${TA}">`
  + `<textarea name="text" rows="8" cols="80" wrap="virtual"></textarea>`
  + `&nbsp;<a href="formatdoc">formatting help</a>`
  + `<br><br><input type="submit" value="reply"></form>`));

write("edit-in.html", pageShell("Edit Comment",
  `<form action="xedit" method="post">`
  + `<input type="hidden" name="parent" value="${STORY_ID}">`
  + `<input type="hidden" name="goto" value="item%3Fid%3D${STORY_ID}">`
  + `<input type="hidden" name="hmac" value="${TB}">`
  + `<input type="hidden" name="id" value="${CID}">`
  + `<textarea name="text" rows="8" cols="80" wrap="virtual">Original comment text.</textarea>`
  + `<br><br><input type="submit" value="edit"></form>`));

write("delete-confirm-in.html", pageShell("Delete",
  `<p>Do you want to delete this comment?</p>`
  + `<form action="xdelete" method="post">`
  + `<input type="hidden" name="parent" value="${STORY_ID}">`
  + `<input type="hidden" name="goto" value="item%3Fid%3D${STORY_ID}">`
  + `<input type="hidden" name="hmac" value="${TA}">`
  + `<input type="hidden" name="id" value="${CID}">`
  + `<input type="submit" value="Yes"></form>`
  + `<a href="item?id=${STORY_ID}">No</a>`));

write("submit-in.html", pageShell("Submit",
  `<b>Submit</b><br><br>`
  + `<form action="r" method="post">`
  + `<input type="hidden" name="fnid" value="AbCdEf123456Zz">`
  + `<input type="hidden" name="fnop" value="submit-page">`
  + `<table border="0"><tbody>`
  + `<tr><td>title:</td><td><input type="text" name="title" size="90"></td></tr>`
  + `<tr><td>url:</td><td><input type="text" name="url" size="90"></td></tr>`
  + `<tr><td>text:</td><td><textarea name="text" rows="8" cols="90" wrap="virtual"></textarea></td></tr>`
  + `</tbody></table><br>`
  + `<input type="submit" value="submit"></form>`,
  "newest"));

write("error-expired.html", pageShell("Error", `<td class="subtext">Unknown or expired link.</td>`));
write("error-badlogin.html", pageShell("Error", `<b>Bad login.</b>`));
write("error-ratelimited.html", pageShell("Error", `<td class="subtext">Sorry, we're not able to serve your requests this quickly. Please try again in a minute.</td>`));
write("error-toofast.html", pageShell("Error", `<td class="subtext">You're posting too fast. Please slow down. Thanks.</td>`));
write("error-validation.html", pageShell("Validation required",
  `<td class="subtext">Validation required</td><div class="g-recaptcha" data-sitekey="placeholder-site-key"></div>`));

// A logged-out variant of the fresh item page for session-flow tests.
let itemOut = injectAuth(item)
  .replace(/<span class="pagetop"><a href="login\?goto=([^"]*)">login<\/a><\/span>/, '<span class="pagetop"><a href="login?goto=item%3Fid%3D' + STORY_ID + '">login</a></span>');
write("item-out.html", itemOut);

console.log("synthetic fixtures written to", outDir);