# ChatDidIt

**Your chat lies. You decide.**

A multiplayer deception game for Twitch: viewers privately submit convincing lies, the server mixes four with one genuine answer, and the streamer tries to spot the truth. Built with Codex, TypeScript, React, Google Cloud and the OpenAI API.

**[Open the deployed demo](https://chatdidit-1077729822037.us-central1.run.app)**. The demo uses sample selection until an OpenAI API key is configured; Twitch registration and credentials are separate setup steps.

## Run locally

Requires Node.js 22+ and npm.

```sh
npm ci
cp .env.example .env
# Set SESSION_SECRET to a random value of at least 32 characters.
npm run dev
```

Open http://localhost:5173. Create a demo room, start the show, and use **Add demo audience** during submissions. Advance phases to preview the reveal without waiting for every timer. For a separate viewer identity, open the viewer link in a private browser window. The host is intentionally prevented from submitting a lie in their own room.

The generated local `.env` in this working copy already contains a random signing secret. It is ignored by Git and excluded from cloud builds. Never commit credentials.

## Game controls and presentation

The game hub uses mode cartridges and an invite/start lobby. Live rounds show a score HUD, a server-timestamp countdown ring and a five-stage progress rail. During the host's choice phase, press **1–5** to select an answer and **Enter** to lock it. Keyboard shortcuts are disabled while typing, in dialogs, or when interacting with unrelated buttons and links.

Reveal sounds are optional and off by default; use **Sound off/on** to enable the synthesized cues. The UI respects reduced-motion preferences. On narrow viewer screens, the question and private submission form appear first, with a sent confirmation and an explicit edit action.

## Interfaces

| Route | Purpose |
| --- | --- |
| `/` | Creator dashboard and match setup |
| `/host/:id` | Authenticated broadcaster controls |
| `/play/:id` | Private audience submissions |
| `/overlay/:id` | Game display for a 1920 × 1080 OBS browser source |
| `/extension/panel.html` | Native Twitch viewer panel for Local Test |
| `/api/health` | Process health |

The panel/config/live-config assets are supplied in `extension/`. Follow [Twitch setup](docs/TWITCH_SETUP.md) to register an application and Extension, configure redirects and backend allowlists, and supply the shared secret. This repository does not claim that an Extension has been registered, reviewed, or activated.

## OpenAI setup

Set `OPENAI_API_KEY` locally and optionally `OPENAI_MODEL` (default `gpt-4.1-mini`), or attach a Secret Manager secret to the Cloud Run environment. The browser never receives API keys.

Without a key, games explicitly show **DEMO · SAMPLE GAME** and use deterministic exact grouping, a basic local text filter, and curated filler lies. With a key, a bounded shortlist of at most 100 distinct candidates goes through OpenAI moderation and structured semantic grouping. AI failure selects only curated fillers. No unreviewed generated facts enter the seed question bank. A separate background question-generation/review product is not implemented yet.

## Google Cloud

Project: `chatdidit-rehaancubes`; region: `us-central1`.

- Cloud Run: Fastify API and built frontend.
- Firestore: private game records, individual viewer submissions, channel-specific fact history, OAuth grants and chat status.
- Cloud Tasks: durable deadline callbacks authenticated with Google OIDC.
- Cloud Scheduler: validates retained Twitch grants every five minutes.
- Secret Manager: session-signing and optional API/Twitch secrets.
- Artifact Registry + Cloud Build: reproducible container builds.

`STORE=firestore` enables durable storage. For Cloud Run set `NODE_ENV=production`, `DEMO_ENABLED=true` for preview only, `PUBLIC_URL` to the deployed origin, `TASKS_ENABLED=true`, and `TASKS_SERVICE_ACCOUNT` to the dedicated runtime service account. Production secrets must be set explicitly; production refuses to invent a signing secret.

Build and deploy instructions are in [deployment](docs/DEPLOYMENT.md). Set `DEMO_ENABLED=false` once real Twitch credentials and identity flows have been tested for launch.

## Verification

```sh
npm test
npm run build
```

Tests cover hidden answers, submission editing, stale writes, ownership, immutable locking, concurrent reveal scoring, timers, question repeat prevention, Extension JWTs, OAuth tampering, webhook verification, token-refresh coordination and task construction.

For the local network load test, start a separate server and then run the harness:

```sh
PORT=8082 LOG_LEVEL=warn npm start
# In another terminal, using the same .env signing secret:
npm run loadtest
```

The harness opens 10,000 concurrent SSE connections and submits one lie per signed synthetic identity. Local tests use loopback; remote tests require explicit opt-in for the dedicated ChatDidIt demo project. It writes measurements to `loadtest-results/latest.json`. The local adapter and deployed GCP demo have both passed synthetic 10,000-player runs; see [capacity evidence and remaining launch verification](docs/CAPACITY.md).

Run a complete demo round over HTTP with `SMOKE_URL=<origin> node --import tsx scripts/smoke.ts`. The smoke test uses two independent demo cookies and checks private edits, ownership, locking, reveal and score updates. It ends its own test match afterward.

## Fairness and state

Only the server holds genuine answers and option correctness. Public serializers expose neither sources nor answer identity before reveal. Private submissions are separate from public state. Twitch Extension JWTs bind a signed identity to the exact channel. State transitions use compare-and-set transactions; submitting a lie never writes a shared game/counter document. Timers use server timestamps; client countdowns are display-only. EventSub uses raw-byte HMAC validation, replay prevention and timestamp checks.

The seed bank contains 20 curated questions. Channel history reserves canonical fact IDs and refuses to recycle them after exhaustion. A full ten-round match consumes ten questions in the chosen mode. The application needs additional reviewed question packs for repeated long-term use.

## Assets and hackathon delivery

Three original raster illustrations were generated with built-in ImageGen and are checked into `frontend/public/assets/`. Their prompts are recorded in `docs/ASSETS.json`. Interface icons use Lucide. No paid fonts, music, or third-party footage are required.

The hackathon still requires a repository URL, an English description, this build's Codex session ID, and a public YouTube demonstration under three minutes showing the app functioning on Twitch and how Codex was used. No submission, video upload, or real Twitch account configuration is performed automatically.
