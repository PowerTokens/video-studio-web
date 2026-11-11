# Video Studio web — usage analytics

Minimal PostHog *capture* of critical events. This is not `posthog-js`:
autocapture, session replay, heatmaps, and person-profile enrichment are off.

No events are stored or sent until the user opts in **and** a project key is
configured for an official ingest host. The committed key is empty; nothing is
live, and offline smoke tests are not a verified backend integration.

## Config names (required before any real event can be verified)

| Name | Where | Value |
| --- | --- | --- |
| `VS_ANALYTICS_CONFIG.posthogProjectKey` | `js/analytics-config.js` (committed default is empty) | PostHog project API key, `phc_...` |
| `VS_ANALYTICS_CONFIG.posthogHost` | same file | Only `https://us.i.posthog.com` or `https://eu.i.posthog.com` |
| `window.VS_POSTHOG_PROJECT_KEY` | Optional host script before `analytics-config.js` | Overrides the file |
| `window.VS_POSTHOG_HOST` | same | Overrides the file |

The client posts to `{host}/i/v0/e/` as documented in the
[Capture API](https://posthog.com/docs/api/capture). Any other host is ignored.
Until a key is present, opted-in events are not queued for later upload.
GitHub Pages has no server env, so fill `analytics-config.js` at deploy time or
inject the `window.VS_POSTHOG_*` values from a private build step.

### CSP

`index.html` and `oauth/callback.html` already allow `connect-src 'self' https:`,
which includes the official ingest hosts (and the PowerTokens API).
`download.html` stays `connect-src 'self'` and does not load the analytics
scripts.

### Project settings (after a key exists, before claiming anonymity)

Per [Controlling data collection](https://posthog.com/docs/privacy/data-collection):

- Events set `$process_person_profile: false` and `$geoip_disable: true`.
- `$ip` is omitted. The ingest host still sees the browser IP. Enable
  **Discard client IP data** in the PostHog project if IPs must not be stored.
- This client does **not** claim IP anonymity.

## Consent

- Default is unset: no `install_id`, no session, no event queue, no network.
- Accepting the notice (or the Account-tab toggle) is required before any
  identifier is minted.
- Denied: only the local denial flag is kept.
- Opting in later does not upload earlier activity.

## Identity (MVP)

`distinct_id` is a random install UUID created only after opt-in, shared across
tabs in `localStorage`. This MVP does **not** link events to a PowerTokens
account. `login_success` is a funnel step only.

## Event schema

Shared properties: `platform=web`, `app_version` (`web-1.15`), `session_id`,
`install_id`. Hash tab changes and `visibilitychange` do not fire `app_open`.
A new session starts after 30 minutes idle.

| Event | When it fires | Extra properties |
| --- | --- | --- |
| `app_open` | Once per session after opt-in | — |
| `login_success` | Once per session, inside OAuth `handleCallback` after a successful sign-in | `key_applied` |
| `generation_start` | New `VSApi.submit` only. Polling resume after a reload is not a new start | `generation_id` (`local_id`), `model` (catalog-like token only), `surface`, optional `requested_duration_s` |
| `generation_success` | Task reaches `done` (including a later resume of the same `local_id`) | `duration_ms` |
| `generation_failed` | Only irreversible states: `rejected` or `failed`. `stopped`, `timeout`, `query_down`, and `ready_no_url` can be resumed and do not close the funnel | safe `error_code` |
| `video_download` | User clicks **Download video** on a task card (including a “opened in a new tab” fallback). Not fired for in-player playback | `model`, `surface` |

Existing chat-pilot `track()` stubs still log to the console / `gtag`. Those
`chat_*` names are dropped by the PostHog allowlist.

Never sent: prompts, API keys, tokens, OAuth codes, URL query strings, email,
name, avatar, media, credits, raw error text, or account ids.

## Dashboard (setup notes only — not proof of ingestion)

Use the same project as desktop if you want a combined view; filter `platform`.

1. **Daily opens** — `app_open`, unique `install_id`.
2. **DAU** — unique `install_id` per day on `app_open`.
3. **Funnel** — `app_open` → `login_success` → `generation_start` →
   `generation_success` → `video_download`. The last step is meaningful on web.
4. **Retention** — unique `install_id`, weekly.
5. **Generation health** — success rate by `model`; failures by `error_code`.

Do not compute revenue or credits from these client events.

## Tests

```text
node scripts/smoke-analytics.mjs
```

## Deploy packaging

The committed `js/analytics-config.js` key stays empty, so the default Pages
build sends no traffic. At deploy time, fill that file (or inject
`window.VS_POSTHOG_PROJECT_KEY` / `window.VS_POSTHOG_HOST`) with the public
project capture token only (`phc_...`). Personal or admin keys are refused by
`publicProjectKey()`.

`scripts/prepare-analytics-config.mjs` can write an untracked
`js/analytics-config.local.js` for local use. Do not add a script tag for that
file on the production `index.html` (a missing file would 404 on GitHub Pages).
`index.html` and `oauth/callback.html` already allow `connect-src https:`, which
includes `https://us.i.posthog.com` and `https://eu.i.posthog.com`.

## Synthetic / test markers

Set `window.VS_ANALYTICS_ENVIRONMENT` / `VS_ANALYTICS_CONFIG.environment` to
`synthetic` or `test`, and `VS_ANALYTICS_TEST_RUN_ID` / `testRunId`, to tag
events so they can be excluded from production insights. Production pages omit
the markers unless configured.
