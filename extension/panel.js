(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ext = window.Twitch?.ext;
  const form = $('submission-form'),
    answer = $('answer'),
    submit = $('submit-button');
  const feedback = $('feedback'),
    connection = $('connection');
  let broadcaster = false;
  let auth,
    backendUrl = '',
    state,
    pollTimer,
    failures = 0,
    busy = false,
    submitting = false,
    lastRound = '',
    lastOwn = '',
    phaseDuration = 30_000;
  let generation = 0,
    streamController,
    phaseKey = '';
  function message(text, error = false) {
    feedback.textContent = text;
    feedback.classList.toggle('error', error);
  }
  function setConnected(value) {
    connection.textContent = value ? 'CONNECTED' : failures ? 'RECONNECTING' : 'CONNECTING';
    connection.classList.toggle('online', value);
  }
  function loggedIn() {
    return typeof auth?.userId === 'string' && auth.userId.startsWith('U');
  }
  function getBackend() {
    try {
      const raw = ext.configuration.broadcaster?.content || ext.configuration.developer?.content;
      const value = raw ? JSON.parse(raw).backendUrl : '';
      if (!value) return '';
      const url = new URL(value);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
      )
        return '';
      return url.origin;
    } catch {
      return '';
    }
  }
  function schedule(delay = 10_000) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, delay);
  }
  function restart() {
    generation += 1;
    clearTimeout(pollTimer);
    streamController?.abort();
    streamController = undefined;
    busy = false;
    if (!document.hidden) schedule(0);
  }
  function unpack(result) {
    return result && Object.prototype.hasOwnProperty.call(result, 'game')
      ? result.game
      : result && Object.prototype.hasOwnProperty.call(result, 'state')
        ? result.state
        : result;
  }
  async function request(path, init = {}) {
    const response = await fetch(backendUrl + path, {
      ...init,
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.message || body.error || `Connection failed (${response.status}).`);
    return body;
  }
  function render(next) {
    state = next;
    if (!state) {
      form.hidden = true;
      $('options').hidden = true;
      $('reveal').hidden = true;
      $('round-label').textContent = 'WAITING FOR A MATCH';
      $('question').textContent = 'A little lie. A big reaction.';
      $('phase-caption').textContent =
        'Your streamer will start the next round. When the question drops, make up an answer worth believing.';
      $('timer').textContent = '—';
      return;
    }
    const roundKey = `${state.id}:${state.round}`;
    if (roundKey !== lastRound) {
      lastRound = roundKey;
      answer.value = '';
      lastOwn = '';
      message('');
    }
    $('round-label').textContent = state.round
      ? `ROUND ${String(state.round).padStart(2, '0')} / ${String(state.totalRounds).padStart(2, '0')}`
      : 'WAITING FOR A MATCH';
    const hiddenFromHost = broadcaster && ['question', 'submission', 'selection'].includes(state.phase);
    $('question').textContent = hiddenFromHost ? 'Chat knows something you don’t.' : state.question?.prompt || 'Ready to bend the truth?';
    $('chat-score').textContent = String(state.scores?.chat ?? 0);
    $('streamer-score').textContent = String(state.scores?.streamer ?? 0);
    $('player-count').textContent = state.submissionCount
      ? `${Number(state.submissionCount).toLocaleString()} LIES IN THE MAKING`
      : 'THE TRUTH IS OUTNUMBERED.';
    const captions = {
      lobby: 'Your streamer is setting the stage. Stay close.',
      question: 'Read the question. A convincing lie is coming.',
      submission: 'The truth is outnumbered. Make your answer believable.',
      selection: 'Finding the most convincing lies. The streamer cannot see who wrote them.',
      deception: 'Five answers. One truth. Make your case in Twitch chat.',
      locked: 'The streamer has locked it in. Time to find out.',
      reveal: 'The truth has entered the chat.',
      finished: 'That’s a wrap. Stay for the next round of deception.',
    };
    $('phase-caption').textContent = state.paused
      ? 'The streamer paused the round. Your lie is safe.'
      : hiddenFromHost ? 'Your viewers get the first look. You’ll see the question when the choices appear.' : captions[state.phase] || 'Waiting for the next round.';
    const open = state.phase === 'submission' && !state.paused;
    form.hidden = broadcaster || state.phase !== 'submission';
    answer.disabled = broadcaster || !open || !loggedIn() || submitting;
    submit.disabled = answer.disabled;
    if (state.ownSubmission?.text && lastOwn !== state.ownSubmission.text) {
      if (document.activeElement !== answer) answer.value = state.ownSubmission.text;
      lastOwn = state.ownSubmission.text;
    }
    submit.replaceChildren(
      document.createTextNode(lastOwn ? 'Update your lie' : 'Submit your lie'),
    );
    const arrow = document.createElement('span');
    arrow.textContent = '↗';
    submit.append(arrow);
    $('character-count').textContent = `${answer.value.length} / 120`;
    if (open && !loggedIn())
      message('Log in to Twitch to submit your lie. No identity sharing is required.');
    const options = $('options');
    options.replaceChildren();
    options.hidden = !state.options?.length;
    for (const [index, option] of (state.options || []).entries()) {
      const row = document.createElement('div');
      row.className = 'option';
      if (state.reveal?.correctOptionId === option.id) row.classList.add('correct');
      const letter = document.createElement('span');
      letter.className = 'option-letter';
      letter.textContent = String.fromCharCode(65 + index);
      const text = document.createElement('span');
      text.textContent = option.text;
      row.append(letter, text);
      options.append(row);
    }
    const reveal = $('reveal');
    reveal.replaceChildren();
    reveal.hidden = !state.reveal;
    if (state.reveal) {
      const title = document.createElement('strong');
      title.textContent = state.reveal.fooled || !state.selectedOptionId ? 'CHAT DID IT!! ✳' : 'THE STREAMER SAW THROUGH IT.';
      const truth = document.createElement('p');
      truth.textContent = `The truth: ${state.reveal.answer}`;
      const explanation = document.createElement('p');
      explanation.textContent = state.reveal.explanation || '';
      reveal.append(title, truth, explanation);
    }
    const nextPhaseKey = `${roundKey}:${state.phase}`;
    if (nextPhaseKey !== phaseKey) {
      phaseKey = nextPhaseKey;
      phaseDuration = Math.max(
        1000,
        Number(state.remainingMs) || Number(state.deadline) - Date.now() || 30_000,
      );
    }
    tick();
  }
  function tick() {
    if (!state) return;
    const remaining = state.paused
      ? Number(state.remainingMs || 0)
      : Math.max(0, Number(state.deadline || 0) - Date.now());
    $('timer').textContent =
      state.deadline || state.paused ? `${Math.ceil(remaining / 1000)}s` : '—';
    $('timer-progress').style.width =
      `${Math.min(100, Math.max(0, (remaining / phaseDuration) * 100))}%`;
    if (state.phase === 'submission' && !state.paused && state.deadline && remaining <= 0) {
      answer.disabled = true;
      submit.disabled = true;
    }
  }
  async function readEvents(controller, currentGeneration) {
    const currentAuth = auth;
    const currentBackend = backendUrl;
    let connectTimeout,
      watchdog,
      reader,
      waiting = false;
    const refreshWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), 45_000);
    };
    try {
      connectTimeout = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(
        `${currentBackend}/api/extension/events?channelId=${encodeURIComponent(currentAuth.channelId)}`,
        {
          method: 'GET',
          credentials: 'omit',
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${currentAuth.token}` },
          signal: controller.signal,
        },
      );
      clearTimeout(connectTimeout);
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.includes('text/event-stream')
      ) {
        throw new Error(`Live connection unavailable (${response.status}). Reconnecting…`);
      }
      if (currentGeneration !== generation) return false;
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '',
        dataLines = [],
        eventName = '',
        eventBytes = 0;
      function dispatch() {
        if (!dataLines.length) {
          eventName = '';
          return;
        }
        const data = dataLines.join('\n');
        dataLines = [];
        eventBytes = 0;
        if (eventName && eventName !== 'message') {
          eventName = '';
          return;
        }
        eventName = '';
        const next = unpack(JSON.parse(data));
        if (currentGeneration !== generation) return;
        render(next?.id ? next : null);
        failures = 0;
        setConnected(true);
        if (feedback.classList.contains('error')) message('');
        if (!next?.id) {
          waiting = true;
          controller.abort();
        }
      }
      refreshWatchdog();
      while (currentGeneration === generation && !controller.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Live connection ended. Reconnecting…');
        refreshWatchdog();
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 1_048_576) throw new Error('Live update exceeded the supported size.');
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line === '') dispatch();
          else if (line.startsWith('data:')) {
            eventBytes += line.length;
            if (eventBytes > 1_048_576) throw new Error('Live update exceeded the supported size.');
            dataLines.push(line.slice(5).replace(/^ /, ''));
          } else if (line.startsWith('event:')) eventName = line.slice(6).trim();
          // Comments/heartbeats, IDs and retry hints contain no public game state.
          if (controller.signal.aborted || currentGeneration !== generation) break;
        }
      }
      return waiting;
    } catch (error) {
      if (waiting) return true;
      throw error;
    } finally {
      clearTimeout(connectTimeout);
      clearTimeout(watchdog);
      if (reader) await reader.cancel().catch(() => {});
    }
  }
  async function poll() {
    if (busy || document.hidden) return;
    if (!auth || !backendUrl) {
      setConnected(false);
      if (!backendUrl) message('Your streamer needs to finish the ChatDidIt Extension setup.');
      return;
    }
    const currentGeneration = generation;
    busy = true;
    let waiting = true;
    try {
      const result = await request(
        `/api/extension/state?channelId=${encodeURIComponent(auth.channelId)}`,
      );
      if (currentGeneration !== generation) return;
      const next = unpack(result);
      render(next?.id ? next : null);
      if (!next?.id) failures = 0;
      setConnected(true);
      if (feedback.classList.contains('error')) message('');
      if (next?.id) {
        streamController = new AbortController();
        waiting = await readEvents(streamController, currentGeneration);
      }
    } catch (error) {
      if (currentGeneration !== generation) return;
      failures += 1;
      setConnected(false);
      message(error.message || 'Reconnecting to the game…', true);
    } finally {
      if (currentGeneration === generation) {
        busy = false;
        streamController = undefined;
        // An established stream stays in readEvents and schedules no HTTP polls.
        // Only a disconnected panel or a channel waiting for a match gets a retry.
        schedule(
          waiting && !failures
            ? 10_000
            : Math.min(60_000, 10_000 * 2 ** Math.min(failures, 3)) + Math.random() * 1000,
        );
      }
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (
      submitting ||
      !auth ||
      !loggedIn() ||
      state?.phase !== 'submission' ||
      state.paused ||
      !answer.value.trim()
    )
      return;
    submitting = true;
    submit.disabled = true;
    answer.disabled = true;
    try {
      const text = answer.value.trim();
      await request('/api/extension/submissions', {
        method: 'POST',
        body: JSON.stringify({ channelId: auth.channelId, text }),
      });
      lastOwn = text;
      message('Lie received. Now keep a straight face.');
      if (state) state = { ...state, ownSubmission: { text, updatedAt: Date.now() } };
    } catch (error) {
      message(error.message || 'Your lie could not be submitted. Try again.', true);
    } finally {
      submitting = false;
      if (state) render(state);
    }
  });
  answer.addEventListener('input', () => {
    $('character-count').textContent = `${answer.value.length} / 120`;
  });
  document.addEventListener('visibilitychange', restart);
  setInterval(tick, 250);
  if (!ext) {
    connection.textContent = 'LOCAL PREVIEW';
    message('Open this panel in Twitch Extension Local Test to join a live game.');
    return;
  }
  ext.configuration.onChanged(() => {
    const next = getBackend();
    if (next !== backendUrl) {
      backendUrl = next;
      restart();
    }
  });
  ext.onAuthorized((nextAuth) => {
    auth = nextAuth;
    try { broadcaster = JSON.parse(atob(nextAuth.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'broadcaster'; } catch { broadcaster = false; }
    backendUrl = getBackend();
    restart();
  });
})();
