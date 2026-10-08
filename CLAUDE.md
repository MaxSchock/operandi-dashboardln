# Operandi Dashboard (dashboardln) · rules for anyone building here

Next.js 14 (app router) on Vercel. Data in Supabase project `xepotlbqlwmriwievyvc`; files in MinIO (`lib/minio.ts`); the video engine and the content daemon run on the VPS and are reached only through the database and their own HTTP APIs.

## UI criterion (Max, 2026-10-07): the page never reloads itself

1. **No full-page reloads** to learn of news or after an action. Data is fetched in the background (a GET route returning the same JSON the page renders with) and only the card that changed is redrawn.
2. **Anything being processed** (video, picture, text, post) shows a turning wheel with what is being made and how long it takes, **in the place where the result will appear**; when done, the result appears there.
3. **Actions** (approve, edit, date, upload) go through `fetch` from a client component and update their own card. No `<form action=... method="post">` with a 303 redirect back to the page.
4. **Signed file links are stable**: `presignGet` signs as of the top of the hour, so a re-render hands the browser the same `src` and a `<video>` keeps playing.
5. `router.refresh()` is for one-off needs (the page header after a change of state), never on an interval.

### How to build it (mandatory for anything new)

- **An action** (any POST from a screen): `<ActionForm action="/api/...">` from `components/action-form.tsx` instead of `<form method="post">`. It sends by `fetch`, disables its fields and shows a wheel, and writes the result or the error inside the form. The route ends with `return answer(req, back)` from `lib/form-answer.ts`: JSON for `ActionForm`, the old 303 for anything else. `?notice=` and `?error=` / `?actionError=` on `back` become the message.
- **A filter or search** (GET): `<FilterForm>` from `components/filter-form.tsx`, which changes the URL without loading the document.
- **A screen whose data changes by itself** (something is being written, drawn, rendered): one loader in `lib/` used by both the page and a GET route, and a client board holding `useState(served)` that asks the GET while there is work and redraws only what changed. Two references: `components/content-board.tsx` + `lib/content-load.ts` + `GET /api/content`; `components/video-staged.tsx` + `lib/video-staged-load.ts`. For a single state, `components/video-status-poller.tsx` asks `GET /api/videos/:id/status` and refreshes once when it changes.
- A new `<form action=... method="post">` or a `setInterval(router.refresh)` is a regression. `scripts-e2e/prod-forms-inplace.py` walks the screens as the canary and counts classic forms: it must print 0.

### State on 2026-10-07

Every screen is migrated: no classic form is left, and the layout's 30 s `AutoRefresh` is gone. In its place `components/page-watch.tsx` asks `GET /api/pulse?path=...` for a short mark of the data behind the screen (`lib/pulse.ts`: row count, newest timestamps and states of the tables that screen reads) and calls `router.refresh()` once, only when the mark changes. A new screen that shows data written by a daemon gets a line in `SCREENS` in `lib/pulse.ts`, or its own GET and board if parts of it are being processed (`content`, `videos/[id]`, which are not in `SCREENS`).

Checked live with the canary: `content` (date saved in place) and the absence of classic forms on every screen it can open. Not exercised live, because the canary is not admin and nothing that costs money or publishes is run as a test: the admin screens (`distribution`, `templates`, `admin/clients`, `calling/find`, `calling/settings`) and the paid or outward actions (revisions, generate, approve, send, video payments).

## Checks before pushing

`node node_modules/typescript/bin/tsc --noEmit -p .` (the `.bin/tsc` link is broken on this checkout). Pushing `main` deploys to production; look at the result with the canary user (`scripts-e2e/prod-canary-cookies.js`, then `scripts-e2e/prod-canary-shot.py <route> "<needle>"`), never by asking Max to check a screen.
