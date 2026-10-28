# Capacity target and evidence

The launch requirement is **10,000 simultaneous players**. The deployed Cloud Run/Firestore demo passed a synthetic 10,000-player transport/submission test. Real Twitch identities, native Extension activation and OpenAI latency remain separate launch checks.

## Deployed GCP result, 28 October 2026

Cloud Run Job execution `chatdidit-loadtest-9j74v` completed successfully against app revision `chatdidit-00002-hvw`. One load generator in GCP opened and retained **10,000 simultaneous SSE connections**, then submitted one lie for each of 10,000 signed synthetic identities. All were accepted and all connections remained open through the final count check.

| Measurement | Result |
| --- | --- |
| Concurrent connected viewers | 10,000 |
| Accepted submissions | 10,000 |
| Measured JSON HTTP requests | 10,006 |
| HTTP p50 | 77 ms |
| HTTP p95 | 3,197 ms |
| Harness duration | 156.45 seconds |
| Backend | Cloud Run + Firestore, `us-central1` |

The duration includes connection ramp-up, setup and submission verification. The host paused the question during connection ramp-up, then resumed and opened the normal 60-second submission window. This is one synthetic run from one load generator. It does not measure the OpenAI selection call, actual Twitch identity exchange, global internet latency, or native Extension iframe behavior. No claim of a general production SLA follows from it.

Durable Cloud Tasks advancement was separately verified by reading the persisted Firestore phase after starting a game with no browser or game-state GET connected. The complete HTTP round smoke test covers private edits, five finalists, immutable locking, reveal and scoring.

## Local result, 28 October 2026

The network harness opened 10,000 concurrent SSE connections and accepted 10,000 distinct authenticated synthetic submissions against the local memory adapter. It measured 6 ms HTTP p50, 11 ms p95 and 2.16 seconds total on this machine. There were 10,004 measured JSON requests. These are local synthetic measurements, not cloud latency or capacity claims.

The engine test also ingested 10,000 identities without updating the shared game document revision. Tests race multiple workers to verify that reveal scoring occurs once.

## Scaling decisions

- Per-viewer submission documents, using hashed document IDs.
- No hot shared counter on each submission; aggregate count is cached/coalesced per process.
- One public-state poll per active room per Cloud Run instance, then fan-out to its local SSE connections.
- Public state changes are broadcast; countdowns run locally from the same server deadline.
- Slow connections are disconnected when queued output exceeds 128 KB.
- AI receives at most 100 distinct candidate groups per round. The model never judges 10,000 individual viewer messages in a realtime call.
- State transitions use Firestore transactions and revision checks. Durable callbacks are idempotent and stale deadlines are discarded.
- Frontend fallback polling runs only when SSE is disconnected.

## Cloud release checks still required

1. Repeat with 10,000 authenticated clients from multiple load generators, including reconnect storms, submission edits and a burst around the deadline.
2. Exercise multiple Cloud Run instances, instance restarts, task redelivery, pause/resume and all answer-lock/reveal paths.
3. Measure submission acceptance p95/p99, phase-change fan-out latency, errors, Firestore contention, write throughput and operating cost.
4. Verify configured regional CPU/instance quotas, max instances, and autoscaling headroom in the actual project.
5. Test OpenAI quota/latency/fallback with an API key, and native Extension identity/attribution with real Twitch test accounts.
6. Configure identity-based abuse controls appropriate for public launch. Current HTTP throttles are per instance; opaque Extension identity and shared Twitch identity are distinct until the viewer shares identity.

Budget alerts are notifications, not hard spending caps. A max-instance setting bounds compute scale but does not guarantee a total bill or prevent database/API costs. Cloud resources should be monitored during staging tests.
