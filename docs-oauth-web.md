# Video Studio Web · OAuth

## Whitelist (exact)

```
https://powertokens.github.io/video-studio-web/oauth/callback.html
```

`client_id`: `powerbaze_desktop_v1`

## Endpoints

| Step | URL |
|------|-----|
| Authorize | `https://www.powertokens.ai/oauth/authorize` |
| Token | `https://powertokens.ai/api/oauth/token` |
| Userinfo | `https://powertokens.ai/api/oauth/userinfo` |
| Revoke | `https://powertokens.ai/api/oauth/revoke` |

## SPA / Pages routing

Tabs use hash routes (`#generate`, `#key`, …) on `/video-studio-web/`.
OAuth callback is a **real file** at `oauth/callback.html` (GitHub Pages 404s unknown paths).
That page exchanges `code` + PKCE verifier, writes the session + API key into `localStorage`, then redirects back into the SPA.

**Landing tab:** bare `/video-studio-web/` (no hash) opens **Chat**. `#generate`, `#tasks`, and `#account` still open those tabs.
**Default after login:** the tab stored in `vsw.oauth.return_hash` (Chat when login starts from the bare page). `#generate` when that stored tab is Generate. Return to `#key` **only** when the user started login from the Key tab.

## Test notes

1. Confirm backend whitelist includes the exact `redirect_uri` above (and `client_id`).
2. Open https://powertokens.github.io/video-studio-web/ (after deploy) or serve this branch locally.
3. Click **登录 PowerTokens** / **Sign in with PowerTokens**.
4. Complete login/consent on powertokens.ai; browser returns to `oauth/callback.html`.
5. Expect redirect back to the tab you left (bare URL / Chat if you started from the landing page; `#generate` if you started from Generate; Key only if login was started from the Key tab). Header shows name + credits; key pool has an active masked key.
6. Generate a short clip to confirm the applied key works.
7. **退出登录** / **Sign out** → revoke called; account chip clears; key can remain in pool (remove manually if desired).
8. Negative: deny consent or break state → callback shows error + link back.

Do not invent prices or model ids in this flow. Never log the userinfo `key`.

## UTM on authorize, signup, and the footer (required)

Authorize, the API-key / signup page, and the footer site link **force** the Video Studio product suite, same as billing. An ad last-touch must not replace it when the user leaves VS web to register or sign in.

- Forced: `utm_source=videostudio` · `utm_medium=web` · `utm_campaign=video-studio`
- Touchpoints: `utm_content=web.oauth_authorize` (authorize), `web.signup` (API keys), `web.footer_site` (footer)
- First/last touch still persist in `localStorage` keys `vsw.utm.first` / `vsw.utm.last`
- Inbound landing `utm_*` / click ids update last-touch (and first if empty). Click ids (gclid etc.) and `utm_term` still forward on these exits; `utm_source` / `utm_medium` / `utm_campaign` do not
- **Billing / chat_billing** use the same force (`utm_content` is `web.billing` or `web.chat_billing`)

README / GitHub get-key links keep `utm_source=github` + `utm_medium=readme` (not in-app). GitHub release and EXE URLs stay raw (no VS UTM).

## Desktop download jump (GitHub Pages)

Studio’s Windows CTA and any ad/官网 link should use:

```
https://powertokens.github.io/video-studio-web/download.html
```

Optional inbound `utm_*` / click ids are captured into the same `vsw.utm.first` / `vsw.utm.last` keys as the SPA (`js/utm.js`). Missing product fields default to `utm_source=videostudio` · `utm_medium=web` · `utm_campaign=video-studio`; missing `utm_content` becomes `web.download_jump`. The page then redirects (meta refresh + `location.replace`) to the latest EXE:

```
https://github.com/PowerTokens/video-studio/releases/latest/download/PowerTokensVideoStudio.exe
```

UTM is **not** appended to the GitHub binary URL (GitHub ignores them). GitHub Pages cannot emit a true HTTP 302.

**官网 powertokens.ai:** point download buttons at this jump URL (or host an identical path / 302 later). Until then, attribution for “unknown GitHub” downloads stays incomplete for traffic that still hits Release assets directly.
