# Setting up phone/computer sync

This app has no server of its own on GitHub Pages - it's just files. To make the
phone and the computer show the same data, one small piece needs to run
somewhere that can hold onto it: a Cloudflare Worker, free, no credit card
needed at this scale. This is a one-time setup. Takes about five minutes.

## 1. Create a Cloudflare account (skip if you already have one)

Go to https://dash.cloudflare.com/sign-up and sign up. Free.

## 2. Create the Worker

1. In the Cloudflare dashboard, left sidebar: **Workers & Pages** → **Create**.
2. Choose **Create Worker**.
3. Name it `eei-sync` (or anything - the name becomes part of its URL).
4. Click **Deploy**. It deploys a placeholder "Hello World" script - that's fine,
   next step replaces it.
5. Click **Edit code**.
6. Delete everything in the editor and paste in the contents of
   `worker/sync-worker.js` from this folder.
7. Click **Save and Deploy**.

## 3. Create somewhere for it to store data

1. Left sidebar: **Workers & Pages** → **KV**.
2. Click **Create a namespace**. Name it `EEI_DATA`. Create.

## 4. Connect the Worker to that storage

1. Go back to the `eei-sync` Worker → **Settings** → **Variables**.
2. Under **KV Namespace Bindings**, click **Add binding**.
3. Variable name: `EEI_KV` (must match exactly, that's what the code looks for).
4. KV namespace: pick `EEI_DATA`.
5. **Save**.

## 5. Get the URL

At the top of the Worker's page you'll see its URL - something like
`https://eei-sync.your-subdomain.workers.dev`. Copy that and send it back.
That's the last piece - once it's plugged into the app, sync is live.
