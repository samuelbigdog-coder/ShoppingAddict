# Deal Command

Sam's personal deal dashboard. It is a plain website (one HTML page plus one data file), hosted free on Cloudflare Pages from a private GitHub repo.

## What is in this repo

| File | What it does |
|---|---|
| `index.html` | The whole dashboard. Design, tabs, cart, filters, everything. |
| `deals_data.js` | This week's deals. The only file that changes when deals are refreshed. |
| `_headers` | Tells Cloudflare not to cache the data file, and keeps search engines out. |
| `robots.txt` | Also keeps search engines out. |

## Refreshing deals (the only regular task)

1. Ask Claude on your computer to run a deal search. Claude rewrites `site/deals_data.js` in your Claude_Deal_Dashboard folder.
2. Open this repo on github.com, click **Add file**, then **Upload files**.
3. Drag in the new `deals_data.js` and click **Commit changes**.
4. Cloudflare rebuilds the site by itself in about a minute. The top bar shows when the deals were last researched.

Your hearts, target prices, carts, budgets, notes and gift picks are never touched by a refresh. They live in your browser, and every item has a fixed ID.

## Moving your saved stuff between devices

Each browser keeps its own copy. Use the **Export memory** and **Import memory** buttons (on the Saved tab and in the footer):

- **Export memory** downloads a small backup file.
- **Import memory** on another device or browser loads it.
- Put an export in your `memory` folder when you want Claude to see what you saved or bought.

The backup can include Rachel's Try On photo, so keep the file private.

## Who can see the site

The repo is private, and the site is locked with Cloudflare Access (free for up to 50 people). Visitors must enter an approved email and type a code that Cloudflare emails them. Setup steps are in `SETUP.md`.
