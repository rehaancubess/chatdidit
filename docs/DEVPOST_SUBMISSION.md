## Inspiration

Chat is often the most entertaining part of a stream. I wanted to turn that energy into the game itself: one streamer trying to find the truth, and an entire community trying to fool them. ChatDidIt makes the audience the opposing team, with private deception, shared suspense and a reveal everyone can react to.

## What it does

ChatDidIt is a live deception game show for Twitch. The streamer picks a mode and topic, shares the room, and starts the show.

- **Fact or Fiction:** chat invents believable wrong answers to a real factual question.
- **Define That!:** chat writes fake meanings for real words.
- **Mixed Bag:** the game alternates between both modes.
- **Six topic choices:** Gaming, Movies, Weird Facts, History, Science and Anything Goes. Topics apply to facts and definitions.

Chat gets the question first; the streamer initially sees only the suspense screen. Viewers privately submit a lie and can edit it before time runs out. The backend prepares five choices containing one genuine answer. The streamer finally sees the question, picks an answer, and locks it in.

If the streamer gets it wrong, chat scores and the game celebrates with **CHAT DID IT!!** The reveal explains the correct answer and provides a supporting source. Scores, mascot reactions, optional audio effects and automatic round progression keep the show moving without constant host controls. A separate OBS browser-source overlay makes it stream-ready.

## How I built it with Codex

Codex was my engineering partner throughout the build. I started with the product specification, then used natural-language feedback to steer the experience: simplify setup to mode → topic → Play, make it feel like a game show, hide the question from the streamer initially, make rounds fully automatic, and give the lime mascot a small companion role with bigger reveal reactions.

Codex helped implement the React interface, Fastify game engine, server-authoritative state machine, private submission APIs and live updates. I also used it for the GCP deployment, Twitch OAuth and Extension configuration, EventSub integration, durable timer callbacks, tests, smoke checks and iterative debugging. Parallel Codex work handled backend, frontend and Twitch integration tasks, followed by integration checks in the actual browsers and deployed app. ImageGen produced the original game artwork and mascot.

This was an iterative build rather than a single generated mockup: the product changed through repeated play-flow feedback, real integration checks and verified fixes.

## Technical implementation

The application uses TypeScript, React, Vite and Fastify. Google Cloud Run serves the frontend and API; Firestore stores game state and private submissions. Cloud Tasks drives durable round deadlines, and Cloud Scheduler validates retained Twitch grants. Secret Manager keeps API and Twitch credentials off the frontend and out of the repository.

OpenAI helps turn noisy audience answers into playable choices. Exact duplicates are grouped first, then a bounded shortlist of at most **100 distinct candidates per round** goes through moderation and structured semantic grouping. The game does not make an AI request for every viewer. If AI selection fails, it falls back to curated alternatives rather than exposing unreviewed answers. The genuine questions and definitions come from a source-backed curated bank of 53 questions.

The Twitch integration includes broadcaster OAuth sign-in, verified EventSub chat delivery, and a native Panel/Mobile Extension configured for **Local Test**. Signed Extension JWTs bind viewers to the correct channel. The broadcaster is blocked from submitting a lie in their own match.

## Challenges and what I learned

The hardest challenge was fairness across several views of the same round. Chat needs the question early, the streamer needs it later, and neither should receive the genuine answer or another viewer's private submission before the reveal. This required distinct serializers, server-side identity checks and careful REST/SSE tests.

Timers and scaling also needed backend decisions, not just animation. State transitions use compare-and-set transactions, deadlines use server time, and submissions avoid writes to a single shared game/counter document. Durable callbacks let rounds progress even when no browser is connected. I learned that a live game is a synchronization and identity problem as much as a UI problem.

## Accomplishments and current status

- A deployed, playable game with six topics, three mode selections, automatic rounds and a reactive mascot.
- Real Twitch sign-in, an installed native Local Test panel, and one verified signed chat-message delivery.
- 32 passing automated tests, Extension REST/SSE smoke checks, and a production round verified with actual OpenAI selection.
- A synthetic backend test with **10,000 simultaneous SSE connections and 10,000 submissions**. This is transport/submission evidence, not a claim of 10,000 real Twitch viewers or end-to-end AI capacity at that audience size.

## What's next

More reviewed question packs, broader playtesting and tuning the balance between convincing lies and readable choices. The Extension still needs public Twitch review. A second real Twitch viewer account and the Twitch mobile app remain to be tested; the current native Extension is not a public release. The standalone demo and viewer link are available for judging while that review work continues.
