# HarmoNova 0.14.0

This release prepares the security remediation for review; publication is a separate action.

Normal HN feeds, search, discussions and native account handoffs remain available. General public-website previews are enabled by default (previously disabled preferences stay off). GitHub, Wikipedia and arXiv retain enriched previews. The Article summary button fetches capped public full-article HTML/text when available; sites that deny access use the discussion fallback. Preview and AI settings now live inside the HarmoNova Settings → AI sidebar. Restoring general websites requires broad HTTP(S) host permissions.

Save fresh AI consent under **Settings → AI** in the extension sidebar before using a stored key. Automatic summaries require separate consent and a real selection. Private tabs keep reader data/drafts only until document reload/navigation/closure; private AI and previews are disabled.

Account actions require trusted gestures, uncertain posts are not replayed, and logout requires a definitive signed-out read-back. Versioned storage migrations preserve sources on failed writes; imports report truncation and draft conflicts are explicit.

The prepared package is `harmonova-0.14.0.zip`. Extract it, load its `harmonova` folder unpacked through `chrome://extensions`, and refresh HN. Keep the same extension folder location to preserve profile data. See [Privacy](PRIVACY.md), [Troubleshooting](TROUBLESHOOTING.md) and [Development](DEVELOPMENT.md) for limits, upgrades and the offline source/release verification commands.

Inspired by Simon Halvdansson's [Harmonic for Hacker News](https://github.com/SimonHalvdansson/Harmonic-HN); independently developed and unaffiliated with HN or Y Combinator.
