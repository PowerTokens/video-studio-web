# PowerTokens Video Studio · Web

Web UI for **PowerTokens Video Studio 1.15** — **Wan · Seedance · Kling · and more** (companion to the Windows desktop app).

Live page: https://powertokens.github.io/video-studio-web/

Desktop app (Windows installer, Chat, batch, model compare, storyboard, continue from the previous clip): https://github.com/PowerTokens/video-studio

Get an API key: https://powertokens.ai/api-keys?utm_source=github&utm_medium=readme&utm_campaign=video-studio-web

网页版（Video Studio **1.15** 配套，支持 **Wan · Seedance · Kling 等**）已发布在上面的地址。桌面版（安装包、对话、批量、模型对比、分镜、接上一段）见 [PowerTokens/video-studio](https://github.com/PowerTokens/video-studio)。

获取 API Key：https://powertokens.ai/zh-Hans/api-keys?utm_source=github&utm_medium=readme&utm_campaign=video-studio-web

## Try it

1. Open the [live page](https://powertokens.github.io/video-studio-web/).
2. Sign in with PowerTokens (header). Paste an API key only under **Account → Advanced** if you need to.
3. Tabs: **Chat** (对话出片, on by default), **Generate**, **History**, **Account**. On a phone, the tabs use short labels (Chat / Generate / History / Account).
4. On **Generate**, tap a preset (Pet daily, Fantasy scene, Fun short, or Drama dialogue) to fill the prompt and match duration, ratio, and resolution. Then **Generate video**.
5. Batch import, model compare, storyboard, and continue-from-previous stay in the [Windows desktop app](https://github.com/PowerTokens/video-studio/releases/latest). Web no longer ships Batch or Compare tabs.

## Chat to video

**对话出片** is a first-class tab (default on; `?pilot=off` still disables it). It calls cheap chat models via `POST https://api.powertokens.ai/v1/chat/completions` (prefer `glm-4.7-flash` with `thinking` disabled; on repeated upstream 429/1305 fall back to `glm-4.5-air` then `deepseek-flash`) using the same Bearer key as Generate, then offers **填进生成表**. Transient errors retry with backoff; on failure you can retry, draft from your text, or fall back to classic Generate.

## OAuth sign-in (web)

Video Studio Web can sign in with PowerTokens OAuth 2.0 (Authorization Code + PKCE S256).

- **Authorize (browser):** `https://www.powertokens.ai/oauth/authorize`
- **Token / userinfo / revoke:** `https://powertokens.ai/api/oauth/*`
- **client_id:** `powerbaze_desktop_v1`
- **redirect_uri (whitelist this exact string):**
  `https://powertokens.github.io/video-studio-web/oauth/callback.html`

After userinfo, the default account `key` is saved into the same local key pool as a manual paste; the header shows name + credits. Sign-out calls `/oauth/revoke` and clears the OAuth session (keys already in the pool stay until you remove them).

There is no green “paste a Key” banner for new users — Sign in in the header is the main path. Manual API Key paste remains under **Account → Advanced** (collapsed).

Credits / top-up still open the PowerTokens billing page in the browser (product-forced UTM). In-app create-payment is not wired yet.

## Languages

Language is a dropdown in the header. On first visit it follows the browser language (zh / en / es / pt / ja / ko). Unrecognized locales default to English. After you pick a language, that choice is stored and always honored.

## Desktop download

Public Windows downloads should go through the jump page so inbound UTM is captured before the EXE:

https://powertokens.github.io/video-studio-web/download.html

That page redirects to the latest `PowerTokensVideoStudio.exe` on GitHub Releases.

## Add to Home Screen

On a phone, after you have used the page for a short time, a dismissible banner can help you add Video Studio to the home screen. iPhone: follow the in-page guide and use Safari’s Share → Add to Home Screen (the website cannot open that system menu). Android: the Add button uses the browser’s install confirmation when the browser provides it; otherwise the guide points to the browser menu. The page still needs an internet connection after it is added. This is not an offline app. The offer is hidden on desktop, when the page is already running in standalone mode, and for a while after you dismiss it.
