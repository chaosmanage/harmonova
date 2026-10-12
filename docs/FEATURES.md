# Using HarmoNova

[← Back to README](../README.md) · [Installation help](TROUBLESHOOTING.md)

HarmoNova changes how you **read** Hacker News, not where the discussions live. Open [news.ycombinator.com](https://news.ycombinator.com/) with the extension enabled. There are two panes: stories on the left, the selected discussion on the right. Both scroll independently.

## The reading view

![HarmoNova showing a story list and nested conversation](assets/overview.png)

### Stories on the left

Choose a feed from the title menu: Top, New, Best, Ask HN, Show HN, Jobs, and additional HN collections such as Active Discussions, Best Comments, Launch HN, and past front pages. Use **Manage feeds** to hide or reorder the less-used ones.

![Feed switcher with Top, New, Best, Ask HN, Show HN, Jobs and Manage feeds](assets/feeds.png)

Each story card can show its title, points, domain, age, reply count, local domain marker, and an optional preview image. Card tints help stories stand apart without turning the entire page into a grid of boxes. Story settings let you change density, preview sizing, points display, dimming for read stories, keyword/domain filters, and whether a card click opens the article or its comments.

Right-click or long-press a read story card and choose **Mark as unread** to undo the dimming and remove that story from saved read history.

Click the comment count to open the discussion in the right pane. Article links open in a normal browser tab; HarmoNova doesn't trap external links in its own reader.

### The discussion on the right

The header holds the story title, link, metadata, author, and the main actions: **Add reply**, **Upvote**, **Article summary**, **Discussion summary**, and **More**. Less-frequent actions, including bookmarks and favorites, belong in the More menu.

Underneath, comments form a tree. Colored depth rails make it easier to see who is answering whom. Click a branch to collapse it; expand it when you want the context back. There are also controls to collapse/expand all comments, search within the current thread, move between top-level comments, and change the comment sort order.

Other useful touches include an **OP** marker beside comments from the story author, optional author avatars, highlighting of newly arrived comments, and collapsible `[delayed]` placeholders.

## Search beyond the current feed

The search field has two distinct modes:

- **Loaded stories** filters what is already on your screen. This stays in the browser.
- **All of Hacker News** queries the public [Algolia HN Search](https://hn.algolia.com/) index. You can filter stories or comments by category, date, points, and author, and sort by relevance or time.

Search results open inside the same reader. For comment results, HarmoNova can take you to the relevant discussion and comment. Site-wide results come from Algolia's index, so an extremely recent comment may not be indexed immediately.

![Site-wide search controls showing content types, dates, sorting and author filters](assets/search.png)

## Your Hacker News account

Reading needs no login. To interact as a user, sign in through **Hacker News's own login page** using the account entry in HarmoNova. HarmoNova doesn't ask for, read, or store your HN password.

When HN supplies the appropriate signed-in controls, you can upvote stories and comments, downvote eligible comments, reply to stories and comments, submit new stories, favorite, hide, and flag eligible items. A flag or destructive action asks for confirmation. Hide also offers an immediate undo. Account views include your threads, submissions, favorites, hidden, and upvoted lists, as well as public user profiles and their public activity. **Settings → Account** provides the same profile, lists, login/logout options as the account chip in the toolbar; neither entry point requires navigating to the other.

### Replies, drafts, and limits

**Add reply** and the reply action on individual comments open the built-in composer. It includes a preview, character counter, and `Ctrl+Enter` to submit. Normal drafts are saved temporarily for the current browser session, keyed to the current account and comment, so closing and reopening a composer doesn't throw away what you typed. Private drafts stay only in the current document and disappear on reload or navigation. If Hacker News requires additional validation, HarmoNova preserves the draft and offers the original HN form.

**Editing or deleting an existing comment is not yet supported inside HarmoNova.** Choose Edit or Delete on one of your own comments, review the notice, and continue to the actual Hacker News form in a separate original-HN tab. Cancelling leaves the comment alone. HN's own anti-automation and rate-limit checks can also prevent other account actions; do not assume a failed confirmation means HN accepted the action.

## Make it your reader

Open **Settings** from HarmoNova's menu or the extension toolbar popup.

![HarmoNova's settings panel organized by category](assets/settings.png)

Settings are organized by **Appearance, Stories, Comments, Web and links, Account, Data, and AI**. You can choose an AMOLED-black, charcoal, or deep-navy color scheme; use Google Sans Flex Rounded by default or switch to System UI or Serif; adjust zoom and story display; change comment treatment; control preview images; and configure link behavior. In the Data section you can export or import bookmarks, read-story IDs, user tags, and blocked-user rules as a JSON file.

| Appearance | Story settings |
| --- | --- |
| ![HarmoNova theme and font controls](assets/appearance.png) | ![HarmoNova story customization controls](assets/story-settings.png) |

Tags and blocking are **private local reading preferences**, not HN account features. Tagging a username helps you recognize them later; blocking replaces their comments with an unblockable placeholder. Neither setting changes what other users see on Hacker News.

### Link extras

- **Rich link previews**, enabled by default and controlled under the sidebar’s AI settings, show public metadata for general websites and enriched facts for GitHub, Wikipedia and arXiv.
- **View on archive** opens the Wayback Machine when you want to look for an older copy of an article.

You can turn these extras off in Settings. External previews are on by default but can be turned off at any time in Settings → AI.

## Optional AI summaries

The **Article** and **Discussion** buttons summarize different sources: bounded public article text and public conversation on HN, respectively.

1. Open Settings → **AI** and configure an [OpenRouter](https://openrouter.ai/) API key through the extension's own settings page.
2. Choose a model (the initial default is `openrouter/free`). Availability and pricing are determined by OpenRouter, not this project.
3. Open a story and click **Article** or **Discussion**. The request runs on a real click, or after a real story selection if you separately enable automatic summaries.
4. You can stop a running summary or regenerate it. The summary appears in the current reader, not in a new service.

![AI settings and OpenRouter configuration in the HarmoNova settings pane](assets/ai-settings.png)

For an Article summary, HarmoNova extracts bounded readable text from the linked public page when the site permits it; provider metadata can supply an excerpt when available. Discussion summarizes public HN comments. The chosen public text is sent to OpenRouter with the saved model and prompt. Saving a key alone does not enable summaries; save fresh consent in Settings → AI. Automatic summaries need separate consent and a real selection. Private summaries are disabled. Generated summaries can be inaccurate.

![AI summary presentation in HarmoNova using test-only sample output](assets/ai-summary-demo.png)

*Demonstration screenshot with a mocked OpenRouter response. The example text is not a real summary of the visible article.*

The AI key can be stored **in this Chrome profile** or **for this browser session only**. It isn't synced via Chrome Sync. See [Privacy & security](PRIVACY.md) for the precise data flow and storage trade-offs.

## Want the original site back?

You have two choices that do not require uninstalling anything:

- **Open original Hacker News** opens an untouched HN tab. Navigation inside that tab remains in original-HN mode.
- **Disable HarmoNova** in the extension toolbar popup or in-page menu turns off the HarmoNova layout. Switch **Enable HarmoNova** back on to restore it.

If something isn't displaying correctly, see [Troubleshooting](TROUBLESHOOTING.md). For implementation details, see [Architecture](ARCHITECTURE.md).
