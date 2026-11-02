# Topic packs

Six quick-start choices: Anything Goes (default), Gaming, Movies, Weird Facts, History, Science. The choice applies to both modes and to every alternating round of Mixed Bag. Existing rooms without a topic use Anything Goes.

The bank now contains **53 distinct questions: 27 facts and 26 definitions**. Questions may have multiple topic tags but retain one canonical identity; playing a Science question also removes it from Anything Goes for that channel. Each specific topic starts with at least five facts and five definitions, supporting a five-round single-mode match or ten-round Mixed Bag match. Ten-round single-mode matches are enabled only when enough fresh questions remain.

The catalog exposes counts, never prompts, answers, aliases or source URLs. Availability is read only for the host’s setup, not on audience submissions. Creation validates the requested pack and full match length. Round reservation remains transactional and prevents repeats across backend instances. Concurrent games can consume availability after setup; if this happens mid-match, the game ends with an explanation rather than substituting another topic or leaving a timer retrying forever.

New content lives in `server/topic-questions.ts`, with original paraphrases, supporting source URLs, and deliberately false filler choices. Original questions retain their IDs and sources in `server/questions.ts`. Sources were checked on November 2, 2026: Nintendo, PlayStation, Tetris, Pixar, Disney D23, Smithsonian, Academy of Motion Picture Arts and Sciences, British Museum, Bletchley Park, Natural History Museum, IOC, UK Parliament, NOAA, NASA, and Merriam-Webster. Sources are shown with the answer at reveal.

Validation: full topic/mode matches, alternation, identity uniqueness, source presence, no repeats, per-channel availability, input validation, legacy configuration and concurrent exhaustion are covered by `server/topics.test.ts` and the existing game tests.
