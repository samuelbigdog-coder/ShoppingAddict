# One-time setup: put Deal Command online (free)

About 15 minutes, done once. Cloudflare's button names change now and then, so look for the closest match if a label differs.

## 1. Repo

The repo stays public (Sam's choice). Search engines are blocked by `_headers` and `robots.txt`.

## 2. Add the site files to the repo (already done Oct 7)

Upload the four files from the `site` folder of your Claude_Deal_Dashboard folder: `index.html`, `deals_data.js`, `_headers`, `robots.txt`. Also upload `README.md`.

1. In the repo, click **uploading an existing file** (or **Add file**, then **Upload files**)
2. Drag the files in. They must sit at the top level of the repo, not inside a folder.
3. Click **Commit changes**

## 3. Connect Cloudflare Pages

1. Make a free account at dash.cloudflare.com (or log in)
2. Go to **Workers & Pages**, click **Create**, choose the **Pages** tab, then **Connect to Git** (sometimes labeled "Import an existing Git repository")
3. Connect your GitHub account. When GitHub asks which repos to allow, pick **Only select repositories** and choose **ShoppingAddict**
4. Select the repo and click **Begin setup**
5. Settings:
   - Project name: `deal-command` (your address becomes deal-command.pages.dev)
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: leave empty
   - Build output directory: leave empty (or `/`)
6. Click **Save and Deploy**. After about a minute the site is live.

From now on, every upload to the repo updates the site automatically.

## 4. Optional: lock the site with Cloudflare Access (free)

1. In the Cloudflare dashboard, open **Zero Trust**. The first time, pick a team name and the **Free** plan (free for up to 50 users). Cloudflare may ask for a card at signup even though the plan costs $0.
2. Go to **Settings**, then **Authentication**, and make sure **One-time PIN** is turned on
3. Go to **Access**, then **Applications**, click **Add an application**, and choose **Self-hosted**
4. Name it `Deal Command` and add two public hostnames:
   - Subdomain empty, domain `deal-command.pages.dev` (the main site)
   - Subdomain `*`, domain `deal-command.pages.dev` (preview copies Cloudflare makes)
5. Add a policy: Action **Allow**, rule **Emails**, and enter your own email. Set the session to 1 month so you rarely have to log in.
6. Save. Then open the site in a private browser window. It should ask for your email and send you a 6 digit code. A different email should be refused.

## 5. Bring your saved stuff over

Your hearts, carts and notes live in each browser, so the new site starts empty.

1. Open `site/index.html` on your computer the old way, go to **Saved**, and click **Export memory**
2. Open the website, go to **Saved**, click **Import memory**, and pick that file
3. Do the same on your phone if you want your saved items there too

## 6. Phone

Open deal-command.pages.dev, log in with the email code, then use **Add to Home Screen** so it opens like an app.

## 7. Accounts and sync (Sam and Rachel)

This makes hearts, carts, notes, don't buy flags and the wishlist follow you to every device, and lets you see each other's likes. Gifts you pick for each other stay hidden. It is all free.

1. **Lock the site with Access** (step 4 above). In the policy, add both emails: yours and Rachel's. Then open the Access application and copy two things:
   - **Team domain**, like `yourteam.cloudflareaccess.com` (Zero Trust, Settings, Custom Pages or Team name)
   - **Application Audience (AUD) Tag** (on the application's Overview or Basic information page)
2. **Make the database:** Workers & Pages, D1 SQL Database, **Create**, name it `shoppingaddict`. No tables needed, the site makes them.
3. **Connect it:** open the `shoppingaddict` Pages project, Settings, **Bindings**, Add, **D1 database**. Variable name `DB`, database `shoppingaddict`. Save.
4. **Add three variables:** same project, Settings, **Variables and Secrets**, add for Production:
   - `USERS` = `sam:YOUR_EMAIL,rachel:HER_EMAIL`
   - `TEAM_DOMAIN` = the team domain from step 1
   - `POLICY_AUD` = the AUD tag from step 1
5. **Redeploy:** Deployments, open the latest, **Retry deployment** (or just publish anything new).
6. **Check it:** open the site. The chip at the top left of the search box should say your name with a green dot. If it says "This device", sync is not connected yet.

The first time you sign in on your main browser, everything already saved there is copied into your account.
