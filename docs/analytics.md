# Video Studio web — usage analytics

Minimal PostHog *capture* of critical events. This is not `posthog-js`:
autocapture, session replay, heatmaps, and person-profile enrichment are off.
No events are sent until the user grants consent **and** a project key is
configured. The committed key is empty; nothing is live yet.

## Config names (required before any real event can be verified)

| Name | Where | Value |
| --- | --- | --- |
| `VS_ANALYTICS_CONFIG.posthogProjectKey` | `js/analytics-config.js` (committed default is empty) | PostHog project API key, `phc_...` |
| `VS_ANALYTICS_CONFIG.posthogHost` | same file | Usually `https://us.i.posthog.com` or `https://eu.i.posthog.com` |
| `window.VS_POSTHOG_PROJECT_KEY` | Optional host script before `analytics-config.js` | Overrides the file |
| `window.VS_POSTHOG_HOST` | same | Overrides the file |

The client posts to `{host}/i/v0/e/`. Until a key is present, consented events
can sit in `localStorage` (`vsw.analytics.state`) but they are not uploaded.
Offline smoke tests are not a live integration. Do not commit a real key.

GitHub Pages has no server env, so the practical path is to fill
`js/analytics-config.js` at deploy time or inject the two `window.VS_POSTHOG_*`
values from a private build step.

## Event schema

Shared properties:

- `platform` = `web`
- `app_version` (currently `web-1.15`)
- `session_id` — reused across tabs via `localStorage`. A new session starts after
  30 minutes idle, or when all state is cleared. Changing hash tabs or a
  `visibilitychange` resume does **not** fire `app_open`.
- `install_id` — anonymous UUID in `localStorage`
- `account_linked` — `true` only when a hashed internal user id is present

`distinct_id` is the install id, or `ptu_` plus a SHA-256 prefix of the
PowerTokens `user_id` (never the raw id, never email).

| Event | When it fires | Extra properties |
| --- | --- | --- |
| `app_open` | Once per session, on first boot of the web app in that session | — |
| `login_success` | Once per session, inside OAuth `handleCallback` after a successful sign-in (main page or `oauth/callback.html`) | `key_applied` |
| `generation_start` | New `VSApi.submit` only. Polling resume after a reload is not a new start | `generation_id` (`local_id`), `model`, `surface`, optional `requested_duration_s` |
| `generation_success` / `generation_failed` | Terminal task state (`done`, or rejected/failed/timeout/query_down/ready_no_url/uncertain/stopped) | `duration_ms`, safe `error_code` only |
| `video_download` | The user clicks **Download video** on a task card (a real download action, including when the browser falls back to opening a tab) | `model`, `surface` |

Existing chat-pilot `track()` stubs still log to the console / `gtag` if present.
Those `chat_*` names are **not** in the PostHog allowlist and are dropped, so
they cannot double-count the critical funnel.

Never sent: prompts, API keys, tokens, OAuth codes, URL query strings
(`location.search` is not copied onto events), email, name, avatar, media,
credits, or raw error text.

## Consent and opt-out

- First visit shows a notice: share / don’t share.
- Until the user chooses, events are held in a bounded local queue (max 50).
- Denied or toggle off: the queue is dropped; later `track` calls are no-ops.
- The persistent checkbox is on the Account tab.

The client fails open: a network error never blocks the UI.

## Dashboard (PostHog) — after a real project key is live

These are setup notes, not proof that data is flowing. Use the same project as
the desktop app if you want a combined view; filter with `platform`.

1. **Daily opens** — trends on `app_open`, count or unique `install_id`, day
   interval, `platform = web`.
2. **DAU** — unique `distinct_id` or `install_id` per day, usually on `app_open`.
   Do not treat GitHub Pages views or EXE downloads as DAU.
3. **Funnel** — `app_open` → `login_success` → `generation_start` →
   `generation_success` → `video_download`. The last step is meaningful on web
   because download is a separate click.
4. **Retention** — unique `install_id`, weekly, first event `app_open`.
5. **Generation health** — success rate by `model`; failures by `error_code`.

Do not compute revenue or credits from these client events. Billing stays on
the PowerTokens backend.

## Tests

```text
node scripts/smoke-analytics.mjs
```

Coverage includes the property allowlist, opt-out, transport failure, duplicate
`app_open` / generation terminal events, rejection of `chat_*` events, and
hashed account ids.
