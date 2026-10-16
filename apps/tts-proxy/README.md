# @lingxi/tts-proxy

Lingxi's "Aria" voice is Microsoft Edge's online neural TTS. A browser can't talk to that endpoint
directly — it checks the connecting `Origin`, which no page JavaScript can override — so this is a
small server-side relay that makes it reachable. It's entirely optional: Lingxi works fully offline
with the on-device Kokoro voices without it.

Because there's no shared default deployment (this is a public repo — a shared relay would mean every
user's listening text flows through one person's server), each user who wants the Aria voice deploys
their own free copy and points their own Lingxi build at it.

## Deploy your own (one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=<YOUR_REPO_URL_HERE>)

Replace `<YOUR_REPO_URL_HERE>` with this repo's GitHub URL once it's pushed. Render reads
`render.yaml` in this directory and spins up a free web service automatically.

## Manual deploy (works even without the button above)

1. Sign in at [render.com](https://render.com) (free tier is enough).
2. **New** → **Blueprint**, paste this repo's GitHub URL.
3. Render finds `apps/tts-proxy/render.yaml` and proposes a `lingxi-tts-proxy` web service — click **Apply**.
4. Once deployed, copy the service URL (e.g. `https://lingxi-tts-proxy-xxxx.onrender.com`).
5. In `apps/web/.env` (create it from `.env.example` if it doesn't exist), set:
   ```
   VITE_TTS_PROXY_URL=https://lingxi-tts-proxy-xxxx.onrender.com
   ```
6. Rebuild/restart the web app. The Aria voice now appears in every voice picker.

## Local development

```
cd apps/tts-proxy
npm install
npm start
```

Then set `VITE_TTS_PROXY_URL=http://localhost:3000` in `apps/web/.env`.

## Environment variables

- `PORT` — port to listen on (Render sets this automatically; defaults to `3000` locally).
- `ALLOWED_ORIGIN` — CORS origin allowed to call this proxy. Defaults to `*`; tighten this to your
  deployed web app's origin if you want to lock the proxy down to only your own frontend.

## A caveat worth knowing

This proxy talks to an unofficial, reverse-engineered endpoint Microsoft ships inside the Edge browser's
"Read aloud" feature — it isn't a documented, supported public API. It works well in practice, but
Microsoft could change or block it at any time, and Render's free tier sleeps after ~15 minutes of
inactivity (the first request after that takes 30–50s to wake up). Treat it as a nice-to-have, not a
guarantee.
