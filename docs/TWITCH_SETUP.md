# Twitch setup

ChatDidIt has two Twitch integrations: OAuth for the standalone dashboard/viewer pages, and a native panel Extension for private in-channel submissions. The Extension's assets are ready for **Local Test**. The production OAuth application and Extension are registered. See the deployment status below; local development still requires its own configured credentials.

## 1. Register the OAuth application

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps), enable account 2FA if Twitch requests it, and register an application.
2. Add the exact redirect URI used by the running backend. The supplied local configuration uses `http://localhost:5173/auth/twitch/callback` through the Vite proxy; use the exact value from `TWITCH_REDIRECT_URI`. For Cloud Run use `https://YOUR-SERVICE.run.app/auth/twitch/callback`.
3. Configure `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and `TWITCH_REDIRECT_URI` on the backend. The Extension has its own client ID; do not substitute the Extension client ID here.
4. Generate a strong `SESSION_SECRET` with at least 32 random bytes. Store production credentials in Google Secret Manager. Never place a client secret, Extension secret or session secret in a Vite/frontend environment variable.
5. Open `/auth/twitch?returnTo=/` to connect. Standalone viewer login can use `returnTo=/play/ROOM_ID`.

The backend uses the [authorization code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow). OAuth state is signed, expires after ten minutes, and must also be compared with the initiating browser's HTTPOnly SameSite cookie. This cookie binding is essential: signature verification alone does not prevent login CSRF. Access tokens must be [validated](https://dev.twitch.tv/docs/authentication/validate-tokens/) and their client ID checked against this application. Twitch requires token validation at startup and at least hourly while maintaining an OAuth session. Persist refreshed credentials server-side; never send refresh tokens to a browser.

Login alone needs no email permission. Request chat permissions only for the account performing chat integration. Basic viewer login should not request chat moderation or posting scopes.

## 2. Register and run the panel Extension in Local Test

1. In [Extensions](https://dev.twitch.tv/console/extensions), create **ChatDidIt** with the **Panel** type. Configure a panel height of 500 pixels (Twitch supports 100–500).
2. Use the backend's `/extension/` asset directory as the Base URI. The deployed base URI is `https://YOUR-SERVICE.run.app/extension/`. It must end in `/`.
3. Set these paths relative to the Base URI:

   | Surface | Path |
   |---|---|
   | Panel Viewer Path | `panel.html` |
   | Mobile Path | `panel.html` |
   | Config Path | `config.html` |
   | Live Config Path | `live-config.html` |

4. Keep the Extension in **Local Test**. Add your broadcaster and test viewer Twitch accounts to the Extension's testing allowlist. Activate the Extension panel on your own channel.
5. Add the backend origin (for example `https://YOUR-SERVICE.run.app`) to the Extension's **Allowlist for URL Fetching Domains**. If CORS is restricted on the backend, allow the exact Extension test/hosted origins. These requests send a signed JWT and omit cookies, so they must never require browser session cookies.
6. Copy the Extension's **base64-encoded shared secret** into the backend's `TWITCH_EXTENSION_SECRET`. Keep the secret base64 encoded; `verifyExtensionToken` decodes it before HMAC verification. Configure the Extension's client ID separately as `TWITCH_EXTENSION_CLIENT_ID` if tracking registration in deployment configuration.
7. Enable **Extension Configuration Service** under Capabilities. Open the Extension configuration page through Twitch. Enter the backend origin, save, and open the streamer dashboard. Backend URL configuration uses Twitch's broadcaster configuration segment; no credential is stored there.
8. Start a match in the dashboard as the broadcaster whose Twitch channel hosts the Extension. The panel resolves the active match by **signed channel ID**; a demo room belonging to another channel will not appear.
9. Open the channel as an allowlisted, logged-in viewer. Submit a lie in the submission phase, edit it, and confirm the streamer cannot see it until finalists are shown. Verify the answer appears only at reveal.

The Extension loads the mandatory [Twitch Extension Helper](https://dev.twitch.tv/docs/extensions/reference/#javascript-helper). Viewer JWTs renew through `onAuthorized`; the latest token is used for all backend requests. Logged-out `A…` identities may read state but cannot submit. Logged-in `U…` opaque identities can submit without sharing their real Twitch identity. No token or submission text is placed in a URL or localStorage. If a viewer uses both the standalone site and the Extension without sharing their Twitch identity with the Extension, the backend cannot reverse the opaque ID to recognize that it is the same account. Cross-surface identity deduplication requires voluntary Twitch identity sharing; per-surface one-submission enforcement still applies. The panel uses `textContent` for arbitrary question and answer text.

The native Extension is not approved or public merely because Local Test works. Public availability requires Twitch's review and release lifecycle. See [development/testing](https://dev.twitch.tv/docs/extensions/required-technical-background/#development-and-testing), [JWT schema](https://dev.twitch.tv/docs/extensions/reference/#jwt-schema), and [Extension policy](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/).

### Panel/backend protocol

- `GET /api/extension/state?channelId=TWITCH_CHANNEL_ID` with `Authorization: Bearer TWITCH_EXTENSION_JWT` returns the active game's public state (or `{game:null}` if no active game). The response may include this viewer's `ownSubmission`. Never include the genuine answer, contributor attribution, private submissions, OAuth credentials or hidden answer IDs before reveal.
- `POST /api/extension/submissions`, same authorization, JSON `{ "channelId": "…", "text": "…" }`. The server verifies the JWT channel matches the request channel, requires a logged-in opaque ID, resolves the active round and persists one editable submission for that identity.
- `GET /api/extension/events?channelId=TWITCH_CHANNEL_ID`, same Bearer authorization, opens a `text/event-stream` connection carrying public game state. The panel uses authenticated fetch streaming (rather than EventSource, which cannot set a Bearer header), supports chunked UTF-8, CRLF and multi-line SSE data, and refreshes the connection when Twitch renews its token. Countdown display runs locally. An active stream does **not** poll the state endpoint. Only disconnected panels or channels waiting for a match poll state, starting at ten seconds with retry backoff. The backend must include approved CORS headers on the raw SSE response as well as its OPTIONS preflight. Measure quotas, connection concurrency and costs with the native panel too; the source code alone does not demonstrate 10,000-player capacity.

## 3. Twitch chat / EventSub

Public Twitch chat is the persuasion layer. Lies are submitted through the private panel or standalone page, never harvested from public chat as secret submissions.

For **Cloud Run + EventSub webhook** chat integration:

1. Authorize the application-owned bot account with `user:read:chat` and `user:bot`. Request `user:write:chat` only if you deliberately implement a message-posting feature; ChatDidIt does not need it merely to read chat.
2. Authorize each broadcaster with `channel:bot` so the bot can subscribe to their channel's chat. Follow Twitch's documented exceptions/conditions for moderator bot accounts if using that alternative.
3. Configure a random ASCII `TWITCH_EVENTSUB_SECRET` (10–100 characters), the application's bot user ID, client ID and client secret. The callback is `https://YOUR-SERVICE.run.app/api/twitch/eventsub` (use the exact route configured by the server).
4. From an authenticated broadcaster session, call `POST /api/twitch/connect-chat` (the dashboard connection control uses this route). The backend obtains an **app access token** and creates `channel.chat.message`, version `1`, using the signed-in broadcaster as the chat-reading bot. This account must have granted `user:read:chat`, `user:bot` and `channel:bot`. For a dedicated bot account, adapt the bot ID and authorize that account separately. No subscription is active until Twitch verifies the callback.
5. The webhook handler must verify HMAC over the message ID, timestamp and **raw body bytes before JSON parsing**. For callback verification return `challenge` as plain text. Acknowledge ordinary notifications quickly. Validate recency and deduplicate event IDs before side effects.
6. In multi-instance production, deduplicate with a Firestore document keyed by a hash of the event ID using atomic `create()`, with an expiry/TTL field. The included in-memory `ReplayGuard` is for a single development process only.
7. Display only relevant chat data, respect moderation/deletion events, and do not expose OAuth tokens. A signed webhook does not itself authorize arbitrary game commands.

An installed user-token chatbot can instead use **EventSub WebSocket** with `user:read:chat`, which avoids the app-token webhook bot permissions. Do not use a user token for webhook subscription creation or an app token for WebSocket subscriptions. See [Twitch chat authentication](https://dev.twitch.tv/docs/chat/authenticating/) and [webhook verification](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).

## Verification performed in this repository

`node --import tsx --test server/twitch.test.ts` verifies token refresh and client/user binding, OAuth state tampering, return-path sanitization, signed session expiry, Extension signature/role/identity/channel enforcement, EventSub raw-body signatures and replay timestamps, and local duplicate protection. Real OAuth callbacks, Extension activation and chat delivery require your Twitch credentials and test accounts.

## Deployment integration checklist

- Keep real Twitch credentials in Secret Manager and out of the repository. The dashboard must clearly show setup requirements until they are configured.
- The callback and Extension viewer pages use different credential types: OAuth client secret vs base64 Extension signing secret. They are not interchangeable.
- `validateOrRefreshTwitchToken` is available for hourly retained-grant checks and for chat setup. The deployment must actually schedule those checks; importing the helper alone does not meet Twitch's validation requirement. On refresh, save the newest refresh token server-side. Network/5xx failures should be retried rather than treated as revoked grants.
- `POST /api/twitch/connect-chat` subscribes the signed-in broadcaster's chat. Webhook verification uses `POST /api/twitch/eventsub`. Keep callback query authorization codes out of HTTP request logs.
- Keep subscription lifecycle separate from message activity: pending before callback verification, enabled after verification, revoked on revocation, and last-message time updated on signed deliveries even between matches. A quiet chat is not evidence of a broken connection.
- A multi-instance deployment needs durable EventSub receipt deduplication and must store subscription state in shared storage. In-memory connection maps are development optimizations, not authoritative records.

## Production setup status — 2 November 2026

- Live game: https://chatdidit-1077729822037.us-central1.run.app
- OAuth application: **ChatDidIt**, client ID `pyp4yghbl6vwudxsl01w02bjx4d9iv`. Confidential application; callback is the live origin plus `/auth/twitch/callback`. Real broadcaster sign-in verified as `rehaancubes`.
- OAuth client and EventSub secrets are stored in GCP Secret Manager, with runtime access scoped to each secret.
- Extension: **ChatDidIt Game**, client ID `qyegie39taxu0qpf58qwiacrddpcvq`, version **0.0.1**, **Local Test**, Panel and Mobile. Own account is on the testing allowlist.
- Saved hosting: live origin plus `/extension/`; panel/mobile `panel.html`, config `config.html`, live config `live-config.html`, panel height 500. Configuration Service is enabled and the live origin is allowlisted for URL fetching and links.
- The exposed unused signing key was revoked and replaced by the user. Its replacement is stored in `chatdidit-twitch-extension` in Secret Manager and bound to the runtime. The temporary transfer file was removed.
- Extension installed and active as **Panel 1** on `rehaancubes`. Broadcaster configuration contains the production backend URL (version `1`), verified through Twitch’s EBS configuration API. Real Twitch-issued tokens connected successfully; the embedded About-page panel and popout both rendered live round updates.
- The only available real account was the broadcaster. Real second-account viewer submission and the Twitch mobile app remain unverified; isolated HTTP tests exercise signed viewer submissions, edits, CORS and SSE. Public release still requires Twitch review.
- OpenAI is configured locally and in production through `chatdidit-openai` in Secret Manager. A small live selection request succeeded locally. Production `/api/me` reports AI configured.
- Real Twitch chat permissions (`user:read:chat`, `user:bot`, `channel:bot`) were approved and granted. EventSub subscription setup completed; the dashboard reports chat connected. One explicitly approved test message was posted to the broadcaster’s own chat. Its real signed EventSub delivery updated the backend’s `lastMessageAt`; delivery is verified.
- Latest game UI, audio and chat-first question behavior are deployed. Broadcaster question visibility is covered by REST and SSE tests, including an opaque-only broadcaster JWT.

### Submission verification

Production HTTP smoke test passed with `SMOKE_REQUIRE_OPENAI=true`: private submission/editing, host question privacy, actual OpenAI selection, five finalists, immutable lock, exactly one score, sourced reveal and next-round secrecy. Unit tests (28) and Extension REST/SSE smoke tests also pass.

During Local Test, only allowlisted accounts see the unreleased Extension. Other judges/testers can use the standalone Twitch-authenticated game and viewer URL. Do not describe Local Test as a public Twitch release.
