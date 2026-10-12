# HarmoNova 0.14.0

This release prepares the security remediation for review; publication is a separate action.

Normal HN feeds, search, discussions and native account handoffs remain available. External previews start disabled and support GitHub, Wikipedia and arXiv only. Unsupported/redirected images use placeholders and favicons use local domain markers. The Article summary button uses provider excerpts/abstracts; arbitrary article extraction is unavailable.

Save fresh AI consent on the extension's **AI and external previews** page before using a stored key. Automatic summaries require separate consent and a real selection. Private tabs keep reader data/drafts only until document reload/navigation/closure; private AI and previews are disabled.

Account actions require trusted gestures, uncertain posts are not replayed, and logout requires a definitive signed-out read-back. Versioned storage migrations preserve sources on failed writes; imports report truncation and draft conflicts are explicit.

The prepared package is `harmonova-0.14.0.zip`. Extract it, load its `harmonova` folder unpacked through `chrome://extensions`, and refresh HN. Keep the same extension folder location to preserve profile data. See [Privacy](PRIVACY.md), [Troubleshooting](TROUBLESHOOTING.md) and [Development](DEVELOPMENT.md) for limits, upgrades and the offline source/release verification commands.

Inspired by Simon Halvdansson's [Harmonic for Hacker News](https://github.com/SimonHalvdansson/Harmonic-HN); independently developed and unaffiliated with HN or Y Combinator.
