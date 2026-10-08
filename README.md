# Deal Command

Sam's personal deal dashboard. It is a plain website (one HTML page plus one data file), hosted free on Cloudflare Pages from this GitHub repo.

## What is in this repo

| File | What it does |
|---|---|
| `index.html` | The whole dashboard. Design, tabs, cart, filters, everything. |
| `deals_data.js` | This week's deals. The only file that changes when deals are refreshed. |
| `_headers` | Tells Cloudflare not to cache the data file, and keeps search engines out. |
| `robots.txt` | Also keeps search engines out. |

## Refreshing deals (the only regular task)

1. Sam tells Claude: "Research new deals and publish ShoppingAddict."
2. Claude researches and updates `deals_data.js` (and `index.html` if the design changed) directly in a local copy of this repo on Sam's computer.
3. Claude shows what changed and waits for Sam's OK.
4. Claude commits and pushes only the website files with GitHub Desktop.
5. Cloudflare Pages rebuilds the site by itself in about a minute. Claude checks that the live site shows the new date. The top bar shows when the deals were last researched.

Private shopping memory, research notes and Rachel's profile live in the separate `Claude_Deal_Dashboard` folder and are never published. `.gitignore` blocks them here too.

Your hearts, target prices, carts, budgets, notes and gift picks are never touched by a refresh. They live in your browser, and every item has a fixed ID.

## Moving your saved stuff between devices

Each browser keeps its own copy. Use the **Export memory** and **Import memory** buttons (on the Saved tab and in the footer):

- **Export memory** downloads a small backup file.
- **Import memory** on another device or browser loads it.
- Put an export in your `memory` folder when you want Claude to see what you saved or bought.

The backup can include Rachel's Try On photo, so keep the file private.

## Who can see the site

This repo and the site are public by choice. Search engines are told to stay away (`_headers` and `robots.txt`), so only people with the link should find it. If you ever want it locked, turn on Cloudflare Access (free for up to 50 people) using step 4 in `SETUP.md`.
