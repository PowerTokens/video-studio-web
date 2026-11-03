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

**Default after login:** `/video-studio-web/#generate` (or bare `/video-studio-web/` which opens Generate).
Return to `#key` **only** when the user started login from the Key tab (`vsw.oauth.return_hash`).

## Test notes

1. Confirm backend whitelist includes the exact `redirect_uri` above (and `client_id`).
2. Open https://powertokens.github.io/video-studio-web/ (after deploy) or serve this branch locally.
3. Click **登录 PowerTokens** / **Sign in with PowerTokens**.
4. Complete login/consent on powertokens.ai; browser returns to `oauth/callback.html`.
5. Expect redirect to `#generate` (or Key only if login was started from the Key tab); header shows name + credits; key pool has an active masked key.
6. Generate a short clip to confirm the applied key works.
7. **退出登录** / **Sign out** → revoke called; account chip clears; key can remain in pool (remove manually if desired).
8. Negative: deny consent or break state → callback shows error + link back.

Do not invent prices or model ids in this flow. Never log the userinfo `key`.

## UTM on authorize (required)

The authorize URL **must** carry last-touch UTM so the backend can attribute sign-in:

- Defaults: `utm_source=videostudio` · `utm_medium=web` · `utm_campaign=video-studio`
- Touchpoint: `utm_content=web.oauth_authorize`
- First/last touch persist in `localStorage` keys `vsw.utm.first` / `vsw.utm.last`
- Inbound landing `utm_*` / click ids update last-touch (and first if empty); OAuth / signup / site CTAs use last-touch
- **Billing / chat_billing** force product identity (`utm_source=videostudio` · `utm_medium=web` · `utm_campaign=video-studio`) even when last-touch was an ad; click ids (gclid etc.) still forward; `utm_content` is `web.billing` or `web.chat_billing`

README / GitHub get-key links keep `utm_source=github` + `utm_medium=readme` (not in-app).

## Follow-up (not in this change)

Desktop download jump page on powertokens.ai (302 to the GitHub `.exe` with UTM) is deferred — keep linking the release URL for now.
