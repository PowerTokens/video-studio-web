# Video Studio web — usage analytics

Minimal PostHog *capture* of critical events. This is not `posthog-js`:
autocapture, session replay, heatmaps, and person-profile enrichment are off.

Capture starts automatically when a project key is
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
Until a key is present, events are not queued for later upload.
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

## Default-on policy (2026-11-12)

Analytics starts automatically with an official public project key. Stored denied
and unset states migrate to granted on load. There is no consent banner or
account toggle. Without a destination, no events are queued or sent.

## Identity (MVP)

`distinct_id` is a random install UUID created locally, shared across
tabs in `localStorage`. This MVP does **not** link events to a PowerTokens
account. `login_success` is a funnel step only.

## Event schema

Shared properties: `platform=web`, `app_version` (`web-1.17`), `session_id`,
`install_id`. Hash tab changes do not fire `app_open`. Switching away from the
tab pauses `active_ms` but does not end the session. A new session starts after
30 minutes idle, or after a real unload; `session_end` is emitted first. A
fresh load also ends an unterminated previous session (crash recovery) before
`app_open`.

| Event | When it fires | Extra properties |
| --- | --- | --- |
| `app_open` | Once per session on startup | — |
| `session_end` | Once per `session_id` when the page unloads, or when a new session starts after the ~30-minute idle window, or on the next start if a previous session was not ended (crash). Tab hide/show within the idle window does not end or double-end the session | `duration_ms` (wall time), `active_ms` (time the page was visible). Integers, each capped at 12 hours |
| `login_start` | User started the OAuth redirect (login button or in-app login start). Not a completed sign-in | — |
| `login_success` | Once per session, inside OAuth `handleCallback` after a successful sign-in | `key_applied` |
| `login_failed` | OAuth/login finished unsuccessfully | safe `error_code` only |
| `logout` | User confirmed Sign out | — |
| `billing_click` | User clicked through to the official credits/billing page. Not a completed payment | `source`: `header`, `account`, `quota`, `credits_chip`, or `chat` |
| `desktop_download_click` | User clicked the in-app Windows download CTA or All releases link, or landed on `download.html` (auto-redirect). Not proof that the desktop app was installed | `source`: `cta`, `releases`, or `redirect` |
| `surface_open` | Once per surface per session when the user actually opens that tab | `surface`: `chat`, `generate`, `tasks`, `account` |
| `key_verified` | Advanced Key-pool **校验并保存** succeeded | — |
| `key_verify_failed` | That same verify-and-save failed | safe `error_code` only |
| `language_set` | User manually changed the UI language (not first-run detection) | `language`: `zh`, `en`, `es`, `pt`, `ja`, `ko` |
| `generation_start` | New `VSApi.submit` only. Polling resume after a reload is not a new start | `generation_id` (`local_id`), `model` (catalog-like token only), `surface`, optional `requested_duration_s`, `input_mode` (`t2v` or `i2v` when a first-frame image/url was or was not attached; omitted if unknown). The image and prompt are never sent |
| `generation_success` | Task reaches `done` (including a later resume of the same `local_id`) | `duration_ms`, optional `input_mode` |
| `generation_failed` | Only irreversible states: `rejected` or `failed`. `stopped`, `timeout`, `query_down`, and `ready_no_url` can be resumed and do not close the funnel | safe `error_code`, optional `input_mode` |
| `video_download` | User clicks **Download video** on a task card (including a “opened in a new tab” fallback). Not fired for in-player playback | `model`, `surface` |
| `chat_submit` | User confirmed **Send** (or Retry) with a non-empty message after the login gate. Not a completed reply | `chat_id`, `surface=chat`, optional `model` |
| `chat_success` | The chat API/model reply for that `chat_id` completed | `chat_id`, `surface=chat`, optional `model` |
| `chat_failed` | The chat API/model reply for that `chat_id` failed | `chat_id`, safe `error_code` only |
| `pwa_offer_shown` | The Add to Home Screen banner actually becomes visible. Once per session. Keyboard hide/show flicker is not a new offer | — |
| `pwa_offer_dismissed` | User persistently dismissed the banner (close control, 30-day cooldown). The in-sheet **Got it** control only hides the offer for this visit and is not this event | — |
| `pwa_install_click` | User tapped the Add CTA. This is a click, not a confirmed install | `cta_kind`: `native-prompt`, `ios-safari-sheet`, `ios-other-sheet`, `android-menu-sheet`, or `none` |
| `pwa_install_accepted` | Chromium `beforeinstallprompt` `userChoice` was `accepted`, or the `appinstalled` event fired. The two signals for the same install are deduped to one success. Never fired for iOS guide sheets | — |
| `pwa_install_prompt_dismissed` | The native Chromium install dialog was dismissed (`userChoice` = `dismissed`). Not the same as the banner's 30-day dismiss | — |
| `pwa_standalone_launch` | Page is already running as a standalone display (`display-mode: standalone` or iOS `navigator.standalone`). Once per session, alongside `app_open`. Not an install-accepted event. This is the only later signal for an iOS Add to Home Screen, which cannot be confirmed at add time | — |


Existing chat-pilot `track()` stubs still log to the console / `gtag`. Legacy
`chat_*` names (`chat_user_message`, `chat_flash_ok`, and similar) stay dropped
by the PostHog allowlist. Only `chat_submit` / `chat_success` / `chat_failed`
are sent, with no message text.

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
`download.html` allows only those two official ingest hosts (plus `'self'`),
so a `desktop_download_click` can be flushed with `sendBeacon`
before the exe redirect; the download is not delayed on failure.

## Synthetic / test markers

Set `window.VS_ANALYTICS_ENVIRONMENT` / `VS_ANALYTICS_CONFIG.environment` to
`synthetic` or `test`, and `VS_ANALYTICS_TEST_RUN_ID` / `testRunId`, to tag
events so they can be excluded from production insights. Shipped pages set `environment=production` by default. Filter production dashboards with `environment = production` (or `environment != synthetic`).

## Step chain (nonlinear)

These steps are related by the same anonymous `install_id` / `session_id`. The product is not a mandatory funnel.

1. **Daily opens and session length** — `app_open` (`platform=web`) and later `session_end` with `duration_ms` / `active_ms`.
2. **Actual chat occurred** — `chat_submit` (user confirmed Send) vs `chat_success` (server reply completed). A local typo-clarify emits submit only.
3. **Video generated** — `generation_start` → `generation_success`, with `input_mode` `t2v` or `i2v` when known.
4. **Added to the phone home screen** — the web app now has an Add to Home Screen offer (manifest + dismissible banner and instruction sheets). Measure it as: `pwa_offer_shown` (banner visible) → `pwa_install_click` (Add tapped) → `pwa_install_accepted` (Chromium `userChoice=accepted` or `appinstalled`, deduped). A 30-day banner close is `pwa_offer_dismissed`; a native dialog cancel is `pwa_install_prompt_dismissed`. iOS (and Android without `beforeinstallprompt`) only opens a guide sheet: the click is real, but the add itself cannot be confirmed at that moment. The only later iOS signal is `pwa_standalone_launch` when a subsequent visit already runs in standalone display mode. Do not treat standalone launch as "install accepted".
5. **Social sharing** — **no existing share feature** (`navigator.share`, social buttons, or a confirmed publish callback). Still unmeasurable. Do not label a post as published. Clipboard copies are not share events.

Filter production dashboards with `environment = production`.

## Automatic UTM and payment funnel

Every newly queued event, including session end, carries plain `utm_source`,
`utm_medium`, `utm_campaign`, optional `utm_content` / `utm_term`, plus the
corresponding `initial_utm_*` fields. Attribution comes from `VSUtm.lastTouch()`
and `VSUtm.firstTouch()`; only those five known fields are copied. Missing core
fields use videostudio / web / video-studio, including when the helper is absent
or fails. Values are trimmed and must match `[A-Za-z0-9._-]{1,80}`; unsafe or
overlong values are omitted. Click ids, URLs and query strings are never copied.
Caller-provided attribution cannot override these touches.

Payment uses the same names intended for desktop:

| Event | Trigger | Properties |
| --- | --- | --- |
| `payment_start` | Confirmed buy, immediately before create request | `package_id`, `channel`, `source=dialog` |
| `payment_checkout_opened` | Successful create with accepted redirect and checkout handoff | `package_id`, `channel` |
| `payment_failed` | Create rejection, network failure or invalid redirect before handoff | `package_id`, `channel`, normalized `error_code` |
| `payment_success` | Existing polling detects paid status or its profile-refresh completion fallback | `package_id`, `channel` when known |

Live official package ids are 22/23 ($20/$50) plus custom 33 (amount_type 2, $5–$2000). Both the default fixed $5 UI preset and the separate Custom card use backend package 33; only the fixed $5 UI preset has the Recommended badge. Package 24 is not a current official package. Package ids are strings; the sanitizer also accepts historical package id 24. Channels are limeng/paypal.
CHECKOUT normalizes to VALIDATION and PAYMENT to UNKNOWN. Payment helpers are
`notify_payment_start`, `notify_payment_checkout_opened`, `notify_payment_failed`,
and `notify_payment_success`; all analytics failures are ignored by checkout.
Safe package/channel context survives pending-payment restoration; old saved
payments may omit it. The create API transport and body remain unchanged.
No payment amounts, balances, credits, order identifiers, checkout URLs, account
identifiers, credentials or raw error messages are analytics properties.

Offline verification: `scripts/smoke-analytics.mjs` and
`scripts/smoke-payment.mjs`. The latter drives the actual dialog handlers in a
mock DOM, stubs every network call and popup, polls success, and exercises create
rejection, invalid redirect, network failure and throwing analytics. It checks
queued event counts, UTM defaults and forbidden-field exclusion. No checkout tab
or live order is created by these tests.
