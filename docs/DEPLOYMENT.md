# GCP deployment

Project `chatdidit-rehaancubes`, region `us-central1`, runtime identity `chatdidit-runtime@chatdidit-rehaancubes.iam.gserviceaccount.com`.

The workspace `.env` stays local. Container builds include only source, the lockfile, and generated assets. The final image serves both the static frontend and Fastify backend.

```sh
npm test
npm run build
gcloud builds submit --tag us-central1-docker.pkg.dev/chatdidit-rehaancubes/chatdidit/app:latest --project=chatdidit-rehaancubes
```

Deploy that image with `gcloud run deploy`, selecting the dedicated runtime identity, `us-central1`, port 8080, a 3600-second request timeout for SSE, at least 1 GiB memory, and a maximum instance count appropriate to a reviewed staging budget. Set a conservative maximum for demo use; raise it only while measuring cloud capacity.

Environment:

```text
NODE_ENV=production
STORE=firestore
GCP_PROJECT_ID=chatdidit-rehaancubes
DEMO_ENABLED=true
PUBLIC_URL=<deployed HTTPS origin>
TASKS_ENABLED=true
TASKS_SERVICE_ACCOUNT=chatdidit-runtime@chatdidit-rehaancubes.iam.gserviceaccount.com
LOG_LEVEL=warn
```

Bind `SESSION_SECRET` to `chatdidit-session:latest` in Secret Manager. A signing-secret rotation signs out existing sessions. Optional `OPENAI_API_KEY`, Twitch application secret, Extension secret and EventSub secret also belong in Secret Manager; grant the runtime access individually. Never embed secrets in client bundles or source-controlled deployment manifests.

The runtime needs Firestore data access, `roles/cloudtasks.enqueuer`, and the user-approved `roles/iam.serviceAccountUser` on itself to attach its identity to tasks. The latter permission is scoped to that single service account. Cloud Tasks uses the `games` queue in `us-central1`. Its OIDC tokens name the runtime identity and use `PUBLIC_URL` as audience. Internal handlers verify token signature, issuer, audience, expiry and service-account identity even when the app itself is public.

Create an authenticated Cloud Scheduler job every five minutes calling `POST <PUBLIC_URL>/internal/validate-twitch` with that same service-account identity and audience. This validates retained Twitch grants even when no browser is open. Games use authenticated Cloud Tasks callbacks to `POST /internal/tick`.

Firestore has no public client reads/writes in this architecture; all application access goes through authenticated backend routes. Do not grant public database IAM or deploy permissive rules. Exempt unused submission text/timestamp fields from automatic indexing before burst testing. Keep game channelId indexed for channel lookup. Enable TTL on EventSub receipts' `expiresAt` to avoid unbounded replay-record storage.

Before launch: turn off demo sessions, configure real Twitch credentials/redirects, complete Extension Local Test with signed JWTs, configure OpenAI API credits, and pass the cloud capacity checks in CAPACITY.md.
