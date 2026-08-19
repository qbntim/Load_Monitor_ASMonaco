# AS Monaco – Load Monitor

A standalone version of the Load Monitor tool. No Claude account needed for
players or coaches — just open the link. Data is stored in a small free Redis
database (Upstash) instead of Claude's artifact storage.

## Deploy it (no coding required)

You'll create two free accounts: **Upstash** (the database) and **Vercel**
(the hosting). Both are free for this use case.

### 1. Create the database (Upstash)

1. Go to https://upstash.com and sign up (free).
2. Click **Create Database**, give it any name (e.g. `load-monitor`), pick a
   region close to Monaco (e.g. an EU region), and create it.
3. Open the database, go to the **REST API** tab.
4. Copy the two values `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   — you'll paste these into Vercel in step 3. Keep this tab open.

### 2. Put the code on GitHub

1. Go to https://github.com and sign up (free), if you don't have an account.
2. Click **New repository**, name it e.g. `load-monitor`, keep it Private,
   create it.
3. On the new repo's page, click **uploading an existing file** (or drag and
   drop). Upload every file and folder from this project, keeping the folder
   structure intact (`app/`, `components/`, `package.json`, etc.).
4. Commit the files.

### 3. Deploy (Vercel)

1. Go to https://vercel.com and sign up with your GitHub account (free).
2. Click **Add New → Project**, select the `load-monitor` repo you just
   created, click **Import**.
3. Before clicking Deploy, open **Environment Variables** and add the two
   values from step 1:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Click **Deploy**. After a minute you'll get a live URL like
   `https://load-monitor-yourname.vercel.app` — that's the link you share
   with your coaches and players.

That's it — no Claude account, no payment, needed by anyone using the link.

## Updating it later

If you (or Claude, in a future chat) change the code, just upload the new
files to the same GitHub repo (or push via `git`) — Vercel redeploys
automatically within a minute or two. Your data in Upstash is untouched by
redeploys; it only changes when the app itself reads/writes it.

## Local development (optional, only if you want to test on your own machine)

Requires [Node.js](https://nodejs.org) installed.

```bash
cp .env.local.example .env.local   # then paste in your Upstash values
npm install
npm run dev
```

Open http://localhost:3000.
