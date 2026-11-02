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

Tabs use hash routes (`#key`, `#generate`, …) on `/video-studio-web/`.
OAuth callback is a **real file** at `oauth/callback.html` (GitHub Pages 404s unknown paths).
That page exchanges `code` + PKCE verifier, writes the session + API key into `localStorage`, then redirects to `/video-studio-web/#key`.

## Test notes

1. Confirm backend whitelist includes the exact `redirect_uri` above (and `client_id`).
2. Open https://powertokens.github.io/video-studio-web/ (after deploy) or serve this branch locally.
3. Click **登录 PowerTokens** / **Sign in with PowerTokens**.
4. Complete login/consent on powertokens.ai; browser returns to `oauth/callback.html`.
5. Expect redirect to `#key`, header shows name + credits, key pool has an active masked key.
6. Generate a short clip to confirm the applied key works.
7. **退出登录** / **Sign out** → revoke called; account chip clears; key can remain in pool (remove manually if desired).
8. Negative: deny consent or break state → callback shows error + link back.

Do not invent prices or model ids in this flow. Never log the userinfo `key`.
