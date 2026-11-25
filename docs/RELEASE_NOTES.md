# HarmoNova 0.14.2

## What's new

### Desktop layout & keyboard navigation
- **Resizable split pane:** drag the divider between stories and comments to resize (double-click or press `Home` to reset; `ArrowLeft`/`ArrowRight` when focused), with your preferred width saved automatically.
- **Focus reading mode:** press `F` (or `Escape` / **Exit focus (F)**) to hide the story list and read full-width.
- **Desktop keyboard controls:** use `ArrowLeft`/`ArrowRight` to move between story cards, `Enter` to open a focused story or collapse/expand a focused comment, `ArrowUp`/`ArrowDown` to move between top-level comments, and `H` to jump to a comment's parent.
- **Viewport-aware top-level navigation:** clicking **`‹ Prev` / `Next ›`** (or pressing `ArrowUp`/`ArrowDown`) now counts from what you are currently looking at in the discussion rather than jumping back from the very top.
- **Remembered reading state:** scroll positions and collapsed branches are remembered per tab for up to 30 recently opened discussions.

### Comment appearance & reading tools
- **Clearer depth indentation & card contrast:** increased default reply indentation (`24 px`, configurable from `8–48 px` in **Settings → Comments**), subtly lifted comment cards off the theme background across AMOLED, Charcoal, and Navy, and defaulted thread rails to Harmonic Classic Dark.
- **More comment controls:** **Indicator width**, **Comment spacing**, **Discussion maximum width**, **Top-level indicators**, **Quote highlighting** & **Quote spacing**, **Scroll wide code blocks**, **Collect reference links**, **Emphasize metadata**, and **Hide dead/flagged comments**.
- **In-thread tools:** **Search in comments** with match stepping (`Enter`/`Shift+Enter`), **New comments only** view, **Peek parent** on replies, right-click **Preview link** metadata previews, and **Ask AI** (under the discussion **More** menu, honoring existing OpenRouter consent and private-tab rules).

### Stories & release automation
- **Clean feed launch:** no longer auto-selects or marks the first story read when opening a feed; the discussion pane stays on the placeholder until you pick a story.
- **Story display options:** **Large** and **Borderless large previews**, **Card tint intensity** slider, and local heuristic **Topic labels** & **Topic filter** (no AI or network requests).
- **Release workflow:** tag-triggered GitHub Actions verification gates published releases.

## Install or update

1. Download `harmonova-0.14.2.zip` from this release's **Assets** and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Choose the extracted `harmonova` folder. If an earlier version is already loaded, remove or replace its unpacked directory first, then reload Hacker News.

External preview requests may contact public websites and their services without browser cookies. Read the [privacy and security details](https://github.com/chaosmanage/harmonova/blob/v0.14.2/docs/PRIVACY.md).
