# PowerTokens Video Studio · Web

Web UI for **PowerTokens Video Studio 1.12** — **Wan · Seedance · Kling · and more** (companion to the Windows desktop app).

Live page: https://powertokens.github.io/video-studio-web/

Desktop app (Windows installer, batch, model compare, storyboard, continue from the previous clip): https://github.com/PowerTokens/video-studio

Get an API key: https://powertokens.ai/api-keys?utm_source=github&utm_medium=readme&utm_campaign=video-studio-web

网页版（Video Studio **1.12** 配套，支持 **Wan · Seedance · Kling 等**）已发布在上面的地址。桌面版（安装包、批量、模型对比、分镜、接上一段）见 [PowerTokens/video-studio](https://github.com/PowerTokens/video-studio)。

获取 API Key：https://powertokens.ai/zh-Hans/api-keys?utm_source=github&utm_medium=readme&utm_campaign=video-studio-web

## Try it

1. Open the [live page](https://powertokens.github.io/video-studio-web/).
2. Add a PowerTokens API key.
3. On **Generate video**, click an example chip (Product · Wan / Short drama · Seedance / Café / Cinematic · Kling) to fill the prompt (click again to clear). Model-tagged chips also switch Settings to that model; then **Generate video**.
4. Batch import, model compare, storyboard, and continue-from-previous stay in the [Windows desktop app](https://github.com/PowerTokens/video-studio/releases/latest).

## OAuth sign-in (web)

Video Studio Web can sign in with PowerTokens OAuth 2.0 (Authorization Code + PKCE S256).

- **Authorize (browser):** `https://www.powertokens.ai/oauth/authorize`
- **Token / userinfo / revoke:** `https://powertokens.ai/api/oauth/*`
- **client_id:** `powerbaze_desktop_v1`
- **redirect_uri (whitelist this exact string):**
  `https://powertokens.github.io/video-studio-web/oauth/callback.html`

After userinfo, the default account `key` is saved into the same local key pool as a manual paste; the header shows name + credits. Sign-out calls `/oauth/revoke` and clears the OAuth session (keys already in the pool stay until you remove them).

Manual API Key paste remains supported.

