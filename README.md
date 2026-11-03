# PowerTokens Video Studio · Web

Web UI for **PowerTokens Video Studio 1.13** — **Wan · Seedance · Kling · and more** (companion to the Windows desktop app).

Live page: https://powertokens.github.io/video-studio-web/

Desktop app (Windows installer, batch, model compare, storyboard, continue from the previous clip): https://github.com/PowerTokens/video-studio

Get an API key: https://powertokens.ai/api-keys?utm_source=github&utm_medium=readme&utm_campaign=video-studio-web

网页版（Video Studio **1.13** 配套，支持 **Wan · Seedance · Kling 等**）已发布在上面的地址。桌面版（安装包、批量、模型对比、分镜、接上一段）见 [PowerTokens/video-studio](https://github.com/PowerTokens/video-studio)。

获取 API Key：https://powertokens.ai/zh-Hans/api-keys?utm_source=github&utm_medium=readme&utm_campaign=video-studio-web

## Try it

1. Open the [live page](https://powertokens.github.io/video-studio-web/).
2. Sign in with PowerTokens (header), or paste an API key under **Account → Advanced**.
3. On **Generate video**, click an example chip (Product · Wan / Short drama · Seedance / Café / Cinematic · Kling) to fill the prompt (click again to clear). Model-tagged chips also switch Settings to that model; then **Generate video**.
4. Batch import, model compare, storyboard, and continue-from-previous stay in the [Windows desktop app](https://github.com/PowerTokens/video-studio/releases/latest).


## Chat to video pilot (optional)

Open with `?pilot=chat` to enable the **对话出片** tab (persists in `localStorage`). It calls cheap chat models via `POST https://api.powertokens.ai/v1/chat/completions` (prefer `glm-4.7-flash` with `thinking` disabled; on repeated upstream 429/1305 fall back to `glm-4.5-air` then `deepseek-flash`) using the same Bearer key as Generate, then offers **填进生成表**. Transient errors retry with backoff; on failure you can retry, draft from your text, or fall back to classic Generate. Use `?pilot=off` to disable.

## OAuth sign-in (web)

Video Studio Web can sign in with PowerTokens OAuth 2.0 (Authorization Code + PKCE S256).

- **Authorize (browser):** `https://www.powertokens.ai/oauth/authorize`
- **Token / userinfo / revoke:** `https://powertokens.ai/api/oauth/*`
- **client_id:** `powerbaze_desktop_v1`
- **redirect_uri (whitelist this exact string):**
  `https://powertokens.github.io/video-studio-web/oauth/callback.html`

After userinfo, the default account `key` is saved into the same local key pool as a manual paste; the header shows name + credits. Sign-out calls `/oauth/revoke` and clears the OAuth session (keys already in the pool stay until you remove them).

Manual API Key paste remains under **Account → Advanced** (collapsed).

## Languages

Language is a dropdown in the header. On first visit it follows the browser language (zh / en / es / pt). Unrecognized locales default to English. After you pick a language, that choice is stored and always honored.

