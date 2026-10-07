# Operandi Dashboard (dashboardln) · rules for anyone building here

Next.js 14 (app router) on Vercel. Data in Supabase project `xepotlbqlwmriwievyvc`; files in MinIO (`lib/minio.ts`); the video engine and the content daemon run on the VPS and are reached only through the database and their own HTTP APIs.

## UI criterion (Max, 2026-10-07): the page never reloads itself

1. **No full-page reloads** to learn of news or after an action. Data is fetched in the background (a GET route returning the same JSON the page renders with) and only the card that changed is redrawn.
2. **Anything being processed** (video, picture, text, post) shows a turning wheel with what is being made and how long it takes, **in the place where the result will appear**; when done, the result appears there.
3. **Actions** (approve, edit, date, upload) go through `fetch` from a client component and update their own card. No `<form action=... method="post">` with a 303 redirect back to the page.
4. **Signed file links are stable**: `presignGet` signs as of the top of the hour, so a re-render hands the browser the same `src` and a `<video>` keeps playing.
5. `router.refresh()` is for one-off needs (the page header after a change of state), never on an interval. The layout's `AutoRefresh` (30 s) is legacy, to be replaced page by page.

Reference implementation: `components/video-staged.tsx` (state + poll of `GET /api/videos/:id/staged` + `Working`), `lib/video-staged-load.ts`, `lib/minio.ts`.

Still to migrate as of 2026-10-07 (classic forms per page): `content` 12 · `videos/[id]` outside the staged flow 7 · `calling` 7 (+3 find, +2 settings) · `distribution` 6 · `engagement` 4 · `templates` 3 (+1 edit) · `admin/clients/[slug]` 3.

## Checks before pushing

`node node_modules/typescript/bin/tsc --noEmit -p .` (the `.bin/tsc` link is broken on this checkout). Pushing `main` deploys to production; look at the result with the canary user (`scripts-e2e/prod-canary-cookies.js`, then `scripts-e2e/prod-canary-shot.py <route> "<needle>"`), never by asking Max to check a screen.
