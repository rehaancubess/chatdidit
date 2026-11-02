import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  Eye,
  Flag,
  Gamepad2,
  Layers3,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Radio,
  Send,
  Settings2,
  ShieldCheck,
  Shuffle,
  SkipForward,
  Sparkles,
  Trophy,
  Twitch,
  Users,
  X,
  Zap,
  Volume2,
  VolumeX,
  Timer,
  Swords,
} from 'lucide-react';

type Mode = 'fact' | 'definition' | 'mixed';
type User = { id: string; displayName: string; role?: string; demo?: boolean; isDemo?: boolean };
type Me = {
  user: User | null;
  demoEnabled: boolean;
  twitchConfigured: boolean;
  aiConfigured: boolean;
};
type Game = {
  id: string;
  channelId: string;
  phase: string;
  mode: string;
  round: number;
  totalRounds: number;
  question?: { prompt: string; category: string };
  options: { id: string; text: string }[];
  deadline?: number | null;
  paused: boolean;
  remainingMs?: number;
  submissionCount: number;
  scores: { chat: number; streamer: number };
  selectedOptionId?: string;
  reveal?: {
    correctOptionId: string;
    answer: string;
    explanation: string;
    sourceUrl: string;
    fooled: boolean;
    contributors: unknown[];
  };
  aiMode?: string;
  canControl?: boolean;
  ownSubmission?: { text: string; updatedAt: number };
  config?: Config;
};
type Config = { mode: Mode; rounds: number; submissionSeconds: number; deceptionSeconds: number };
const defaultConfig: Config = {
  mode: 'fact',
  rounds: 5,
  submissionSeconds: 30,
  deceptionSeconds: 25,
};
const modes = [
  {
    id: 'fact' as Mode,
    label: 'Fact or Fiction',
    eyebrow: 'THE ORIGINAL',
    description: 'Weird facts. Convincing lies. One very suspicious streamer.',
    art: '/assets/mode-facts.png',
    tone: 'orange',
    icon: CircleHelp,
  },
  {
    id: 'definition' as Mode,
    label: 'Define That!',
    eyebrow: 'WORD ON THE STREET',
    description: 'Real words. Completely made-up meanings. Can you tell?',
    art: '/assets/mode-definitions.png',
    tone: 'purple',
    icon: BookOpen,
  },
  {
    id: 'mixed' as Mode,
    label: 'Mixed Bag',
    eyebrow: 'KEEP THEM GUESSING',
    description: 'A little of everything. A whole lot of second-guessing.',
    art: '/assets/chatdidit-hero.png',
    tone: 'green',
    icon: Shuffle,
  },
];
const phaseLabels: Record<string, string> = {
  lobby: 'Waiting for the show',
  question: 'The question',
  submission: 'Make your lie',
  selection: 'Finding the best lies',
  deception: 'Convince the streamer',
  locked: 'Answer locked',
  reveal: 'The moment of truth',
  finished: 'That’s a wrap',
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r
    .json()
    .catch(() => ({ error: 'The server returned an unexpected response.' }));
  if (!r.ok)
    throw Object.assign(
      new Error(
        typeof data.error === 'string'
          ? data.error
          : data.error?.message || data.message || 'Something went wrong. Please try again.',
      ),
      { status: r.status, code: data.code, needsAuthorization: data.needsAuthorization },
    );
  return data;
}
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`brand ${compact ? 'brand-compact' : ''}`} href="/" aria-label="ChatDidIt home">
      <span className="brand-symbol">
        <MessageCircle size={23} fill="currentColor" strokeWidth={1.5} />
        <span>×</span>
      </span>
      <span>
        ChatDidIt<span className="brand-dot">.</span>
      </span>
    </a>
  );
}
function App() {
  const [path, setPath] = useState(location.pathname);
  const [me, setMe] = useState<Me>({
    user: null,
    demoEnabled: false,
    twitchConfigured: false,
    aiConfigured: false,
  });
  const [meLoaded, setMeLoaded] = useState(false);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(false);
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState('');
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const fn = () => setPath(location.pathname);
    addEventListener('popstate', fn);
    return () => removeEventListener('popstate', fn);
  }, []);
  useEffect(() => {
    api<Me>('/api/me')
      .then(setMe)
      .catch((e) => setToast(e.message))
      .finally(() => setMeLoaded(true));
  }, []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  function navigate(url: string) {
    history.pushState({}, '', url);
    setPath(url);
    window.scrollTo(0, 0);
  }
  async function ensureDemo() {
    const data = await api<{ user: User }>('/api/demo/session', {});
    setMe((prev) => ({ ...prev, user: data.user }));
    return data.user;
  }
  async function create() {
    setWorking(true);
    try {
      if (!me.user) {
        if (me.demoEnabled) await ensureDemo();
        else {
          location.href = '/auth/twitch?returnTo=/';
          return;
        }
      }
      const result = await api<{ gameId: string; state: Game }>('/api/games', config);
      localStorage.setItem('chatdidit-room', result.gameId);
      setModal(false);
      navigate('/host/' + result.gameId);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  function openCreate(mode: Mode = 'mixed') {
    setConfig((c) => ({ ...c, mode }));
    setModal(true);
  }
  function goTab(next: string) {
    if (next === 'live') {
      const id = localStorage.getItem('chatdidit-room');
      if (id) {
        navigate('/host/' + id);
        return;
      }
      openCreate();
      return;
    }
    if (path !== '/') navigate('/');
    setTab(next);
  }
  const match = path.match(/^\/(host|play|overlay)\/([^/]+)$/);
  const isOverlay = match?.[1] === 'overlay';
  return (
    <div className={isOverlay ? 'app overlay-app' : 'app'}>
      {!isOverlay && match?.[1] !== 'play' && (
        <header className="game-header">
          <Brand />
          <nav className="game-navigation" aria-label="Game navigation">
            <button
              className={!match && tab === 'overview' ? 'active' : ''}
              onClick={() => goTab('overview')}
            >
              <Gamepad2 size={18} />
              Play
            </button>
            <button className={match ? 'active' : ''} onClick={() => goTab('live')}>
              <Radio size={17} />
              My room
            </button>
            <button onClick={() => setHelp(true)}>
              <CircleHelp size={17} />
              How to play
            </button>
          </nav>
          <div className="game-account">
            {me.user ? (
              <>
                <span className="player-avatar">
                  {me.user.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="player-name">{me.user.displayName}</span>
                <button
                  className="icon-button"
                  title="Sign out"
                  aria-label="Sign out"
                  onClick={async () => {
                    try {
                      await api('/auth/logout', {});
                      setMe((m) => ({ ...m, user: null }));
                      navigate('/');
                    } catch (e) {
                      setToast((e as Error).message);
                    }
                  }}
                >
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <button
                className="connect-button"
                onClick={() =>
                  me.twitchConfigured
                    ? location.assign('/auth/twitch?returnTo=/')
                    : setToast(
                        'Try a demo game now. Connect Twitch when your app credentials are ready.',
                      )
                }
              >
                <Twitch size={16} />
                Connect Twitch
              </button>
            )}
          </div>
        </header>
      )}
      <div className="main-shell">
        {match ? (
          <GameRoom
            key={match[2] + match[1]}
            id={match[2]}
            kind={match[1]}
            me={me}
            ensureDemo={ensureDemo}
            notify={setToast}
            navigate={navigate}
          />
        ) : (
          <main className="dashboard">
            {tab === 'overview' ? (
              <>
                <section className="hero game-hub-hero">
                  <div className="hero-copy">
                    <span className="hero-badge">
                      <Swords size={14} />
                      THE PARTY GAME WHERE CHAT PLAYS DIRTY
                    </span>
                    <h1>
                      Your chat lies.
                      <br />
                      <span>You decide.</span>
                    </h1>
                    <p>
                      One streamer. One true answer.
                      <br />
                      An entire community trying to fool you.
                    </p>
                    <div className="hero-actions">
                      <button
                        className="button button-lime button-play"
                        onClick={() => openCreate('fact')}
                      >
                        <Play size={19} fill="currentColor" />
                        Let’s play
                        <ArrowRight size={18} />
                      </button>
                      <button className="text-button" onClick={() => setHelp(true)}>
                        Learn the game <CircleHelp size={17} />
                      </button>
                    </div>
                    <div className="hero-game-facts">
                      <span>
                        <Users size={14} />
                        Chat vs. streamer
                      </span>
                      <span>
                        <Timer size={14} />
                        90-second rounds
                      </span>
                      <span>
                        <ShieldCheck size={14} />
                        Free to join
                      </span>
                    </div>
                  </div>
                  <div className="hero-art">
                    <img
                      src="/assets/chatdidit-hero.png"
                      alt="A crew of sculptural lime chat characters ready to cause trouble"
                    />
                  </div>
                  <div className="hero-sticker">
                    <span>TRUST</span>
                    <strong>NOBODY.</strong>
                    <Sparkles size={16} />
                  </div>
                  <div className="hero-corner">
                    <span>01</span> THE TRUTH IS OUTNUMBERED
                  </div>
                </section>
                <section className="mode-section">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">CHOOSE YOUR CHALLENGE</span>
                      <h2>How do you want to play?</h2>
                    </div>
                    <span className="game-pick-label">
                      <Gamepad2 size={16} />
                      Pick a mode to jump in
                    </span>
                  </div>
                  <div className="mode-grid">
                    {modes.map(({ id, label, eyebrow, description, art, tone, icon: Icon }, i) => (
                      <button
                        className={`mode-card ${tone}`}
                        key={id}
                        onClick={() => openCreate(id)}
                      >
                        <div className="mode-art">
                          <img src={art} alt="" />
                          <span className="mode-cartridge-number">0{i + 1}</span>
                          <span className="mode-icon">
                            <Icon size={23} />
                          </span>
                          {id === 'fact' && (
                            <span className="popular-tag">FIRST TIME? START HERE</span>
                          )}
                        </div>
                        <div className="mode-copy">
                          <span className="card-eyebrow">{eyebrow}</span>
                          <h3>
                            {label}
                            <ArrowRight size={20} />
                          </h3>
                          <p>{description}</p>
                          <span className="mode-footer">
                            <span className="mode-play-cue">
                              <Play size={11} fill="currentColor" />
                              PLAY THIS MODE
                            </span>
                            <span>CHAT VS. YOU</span>
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="how-strip">
                  <span className="how-strip-title">
                    <Sparkles size={22} />
                    <strong>
                      Simple rules.
                      <br />
                      Questionable friends.
                    </strong>
                  </span>
                  <div>
                    <span>01</span>
                    <strong>Chat makes up lies</strong>
                    <p>Private answers. Collective mischief.</p>
                  </div>
                  <ChevronRight size={20} />
                  <div>
                    <span>02</span>
                    <strong>You pick the truth</strong>
                    <p>Five choices. Trust your instincts.</p>
                  </div>
                  <ChevronRight size={20} />
                  <div>
                    <span>03</span>
                    <strong>Everyone loses it</strong>
                    <p>Reveal the answer. Settle the score.</p>
                  </div>
                </section>
                <footer className="dashboard-footer">
                  <span>
                    <span className="small-logo">✳</span> Less lurking. More lying.
                  </span>
                  <div className="footer-game-links">
                    <button onClick={() => goTab('questions')}>Inside the question bank</button>
                    <button onClick={() => setHelp(true)}>How to play</button>
                    <span>BUILT WITH CODEX</span>
                  </div>
                </footer>
              </>
            ) : tab === 'questions' ? (
              <QuestionBank />
            ) : (
              <HallOfLies openCreate={() => openCreate()} />
            )}
          </main>
        )}
      </div>
      {modal && (
        <div className="modal-backdrop" onClick={() => !working && setModal(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close"
              onClick={() => setModal(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">YOUR SHOW. YOUR RULES.</span>
            <h2 id="modal-title">
              Choose your game<span>.</span>
            </h2>
            <p className="modal-intro">
              Pick a mode and play. The show runs automatically.
            </p>
            <label className="field-label">Game mode</label>
            <div className="mode-select">
              {modes.map((m) => (
                <button
                  key={m.id}
                  className={config.mode === m.id ? 'selected' : ''}
                  onClick={() => setConfig((c) => ({ ...c, mode: m.id }))}
                >
                  <m.icon size={19} />
                  <span>{m.label}</span>
                  {config.mode === m.id && <CheckCircle2 size={16} />}
                </button>
              ))}
            </div>
            <p className="setup-summary">{config.rounds} rounds · Chat writes for {config.submissionSeconds}s · You choose in {config.deceptionSeconds}s</p>
            <details className="customize-game"><summary>Customize game</summary>
            <label className="field-label">Number of rounds</label>
            <div className="segmented">
              {[3, 5, 10].map((n) => (
                <button
                  key={n}
                  className={config.rounds === n ? 'selected' : ''}
                  onClick={() => setConfig((c) => ({ ...c, rounds: n }))}
                >
                  {n} rounds{n === 5 && <span>CLASSIC</span>}
                </button>
              ))}
            </div>
            <div className="two-fields">
              <label>
                Submission timer
                <select
                  value={config.submissionSeconds}
                  onChange={(e) => setConfig((c) => ({ ...c, submissionSeconds: +e.target.value }))}
                >
                  {[15, 30, 45, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} seconds
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Deception timer
                <select
                  value={config.deceptionSeconds}
                  onChange={(e) => setConfig((c) => ({ ...c, deceptionSeconds: +e.target.value }))}
                >
                  {[15, 25, 30, 45, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} seconds
                    </option>
                  ))}
                </select>
              </label>
            </div>
            </details>
            <div className="info-note">
              <ShieldCheck size={18} />
              <p>
                {me.user
                  ? 'Your room is private until you share the viewer link.'
                  : me.demoEnabled
                    ? 'No Twitch account connected? Start a demo now. Connect Twitch for your live community.'
                    : 'Connect your Twitch account to create and host a game.'}
              </p>
            </div>
            <button
              className="button button-dark full-width"
              onClick={create}
              disabled={working || !meLoaded}
            >
              {working ? <LoaderCircle size={18} className="spin" /> : <Radio size={18} />}{' '}
              {working
                ? 'Creating your room…'
                : me.user
                  ? 'Play'
                  : me.demoEnabled
                    ? 'Play a demo'
                    : 'Continue with Twitch'}
              <ArrowRight size={17} />
            </button>
          </section>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">WELCOME TO THE CONSPIRACY</span>
            <h2 id="help-title">The truth is outnumbered.</h2>
            <p>
              Every round, your viewers secretly write believable fake answers to a surprising
              question. We mix four lies with one verified truth.
            </p>
            <ol>
              <li>
                <strong>Start your show.</strong> Create a room, share its viewer link, and add the
                OBS display to your stream.
              </li>
              <li>
                <strong>Chat writes the lies.</strong> Each player submits privately, so your poker
                face gets a fair chance.
              </li>
              <li>
                <strong>You make the call.</strong> Debate with chat, lock in an answer, then see
                who fooled whom.
              </li>
            </ol>
            <div className="info-note">
              <Trophy size={20} />
              <p>
                Choose the truth: streamer gets a point. Fall for a lie: chat scores. Simple,
                devious, repeatable.
              </p>
            </div>
            <button
              className="button button-dark full-width"
              onClick={() => {
                setHelp(false);
                openCreate();
              }}
            >
              I’m in. Create a game <ArrowRight size={17} />
            </button>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleHelp size={18} />
          <span>{toast}</span>
          <button className="icon-button" aria-label="Dismiss" onClick={() => setToast('')}>
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
function QuestionBank() {
  const [catalog, setCatalog] = useState<{
    modes: { id: string; name: string; count: number }[];
    totalQuestions: number;
  } | null>(null);
  useEffect(() => {
    api<{ modes: { id: string; name: string; count: number }[]; totalQuestions: number }>(
      '/api/catalog',
    )
      .then(setCatalog)
      .catch(() => {});
  }, []);
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">GOOD QUESTIONS. BETTER LIES.</div>
          <h1>
            The question bank<span>.</span>
          </h1>
          <p>Source-backed curiosities built to make you second-guess everything.</p>
        </div>
        <span className="status-pill">
          <ShieldCheck size={14} />
          Source-backed questions
        </span>
      </section>
      <div className="bank-notice">
        <Eye size={21} />
        <div>
          <strong>Some things are better left a mystery.</strong>
          <p>
            The server keeps every question’s correct answer hidden until the reveal and tracks
            previously used facts for each channel. Browse the modes here without spoiling your next
            round.
          </p>
        </div>
      </div>
      <div className="question-list">
        {modes
          .filter((m) => m.id !== 'mixed')
          .map((m, i) => (
            <article className="question-row" key={m.id}>
              <span className="question-number">0{i + 1}</span>
              <div>
                <span className="card-eyebrow">{m.eyebrow}</span>
                <h3>{m.label}</h3>
                <p className="catalog-description">{m.description}</p>
                <span className="catalog-count">
                  {catalog
                    ? `${catalog.modes.find((x) => x.id === m.id)?.count ?? 0} source-backed questions`
                    : 'Loading question catalog…'}{' '}
                  · Answers stay sealed
                </span>
              </div>
              <ShieldCheck size={20} />
            </article>
          ))}
      </div>
      <div className="bank-notice catalog-footnote">
        <ShieldCheck size={21} />
        <div>
          <strong>Fresh facts. Fair play.</strong>
          <p>
            Each question has a canonical fact identifier and a supporting source. Channel history
            prevents known facts from repeating. If the bank runs out, the game asks for fresh
            verified content instead of silently repeating.
          </p>
        </div>
      </div>
    </>
  );
}
function HallOfLies({ openCreate }: { openCreate: () => void }) {
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">GIVE CREDIT TO THE CON ARTISTS</div>
          <h1>
            The hall of lies<span>.</span>
          </h1>
          <p>Great deception deserves a little recognition.</p>
        </div>
      </section>
      <section className="empty-state">
        <span className="empty-icon">
          <Trophy size={37} />
        </span>
        <h2>Every legend starts with a lie.</h2>
        <p>
          Winning contributors are recognized in each round’s reveal.
          <br />
          Play your first game to give your community its moment.
        </p>
        <button className="button button-dark" onClick={openCreate}>
          Start a game <ArrowRight size={17} />
        </button>
      </section>
    </>
  );
}
function GameRoom({
  id,
  kind,
  me,
  ensureDemo,
  notify,
  navigate,
}: {
  id: string;
  kind: string;
  me: Me;
  ensureDemo: () => Promise<User>;
  notify: (s: string) => void;
  navigate: (s: string) => void;
}) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [selected, setSelected] = useState('');
  const [connected, setConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const lastCue = useRef('');
  const isOverlay = kind === 'overlay',
    isViewer = kind === 'play';
  const sourceRef = useRef<EventSource | null>(null);
  const submissionHydrated = useRef('');
  useEffect(() => {
    let stopped = false;
    const pull = () =>
      api<Game | { state: Game }>('/api/games/' + id)
        .then((data) => {
          if (!stopped) {
            setGame('state' in data ? data.state : data);
            setError('');
          }
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    pull();
    const source = new EventSource('/api/games/' + id + '/events', { withCredentials: true });
    sourceRef.current = source;
    source.onopen = () => setConnected(true);
    source.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setGame(data.state || data);
        setError('');
        setConnected(true);
      } catch {}
    };
    source.onerror = () => setConnected(false);
    const poll = setInterval(() => {
      if (source.readyState !== EventSource.OPEN) pull();
    }, 5000);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      stopped = true;
      source.close();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [id]);
  useEffect(() => {
    setAnswer('');
    setSubmitted(false);
    setSelected('');
    submissionHydrated.current = '';
  }, [game?.round]);
  useEffect(() => {
    const key = id + ':' + game?.round;
    if (game?.ownSubmission && submissionHydrated.current !== key) {
      setAnswer(game.ownSubmission.text);
      setSubmitted(true);
      submissionHydrated.current = key;
    }
  }, [game?.ownSubmission?.text, game?.round, id]);
  async function action(action: string, optionId?: string) {
    setBusy(true);
    try {
      const data = await api<Game | { state: Game }>('/api/games/' + id + '/actions', {
        action,
        optionId,
      });
      setGame('state' in data ? data.state : data);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!me.user && me.demoEnabled) await ensureDemo();
      await api('/api/games/' + id + '/submissions', { text: answer });
      setSubmitted(true);
      notify('Your lie is in. Keep a straight face.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      notify('Link copied. Let the conspiracy begin.');
    } catch {
      notify('Copy this link: ' + url);
    }
  }
  function toggleSound() {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }
    try {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current ??= new AudioCtor();
      void audioRef.current.resume();
      setSoundEnabled(true);
    } catch {
      notify('Audio isn’t available in this browser.');
    }
  }
  function playCue(notes: number[], duration = 0.16, volume = 0.045) {
    const context = audioRef.current;
    if (!context || context.state !== 'running') return;
    notes.forEach((frequency, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * duration * 0.7;
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }
  useEffect(() => {
    if (!game || !soundEnabled || game.paused) return;
    const key = id + ':' + game.round + ':' + game.phase;
    if (lastCue.current === key) return;
    lastCue.current = key;
    if (game.phase === 'question') playCue([392, 523, 784], 0.22);
    else if (game.phase === 'submission') playCue([440, 660], 0.18);
    else if (game.phase === 'deception') playCue([392, 494, 587, 784], 0.18);
    else if (game.phase === 'locked') playCue([220, 110], 0.13);
    else if (game.phase === 'reveal') {
      const won = !!game.selectedOptionId && !game.reveal?.fooled;
      playCue(won ? [523, 659, 784, 1047] : [330, 277, 220, 165], 0.25);
    } else if (game.phase === 'finished') playCue([523, 659, 784, 1047, 784, 1047], 0.28);
  }, [game?.phase, game?.round, game?.paused, soundEnabled, id]);
  const lastTick = useRef('');
  useEffect(() => {
    if (!game || !soundEnabled || game.paused || !['submission', 'deception'].includes(game.phase)) return;
    const remaining = Math.ceil(((game.deadline || 0) - now) / 1000);
    const key = `${game.round}:${game.phase}:${remaining}`;
    if (remaining < 1 || remaining > 5 || lastTick.current === key) return;
    lastTick.current = key;
    playCue([remaining === 1 ? 880 : 660], 0.07, 0.025);
  }, [now, game?.phase, game?.round, game?.paused, soundEnabled]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !game ||
        kind !== 'host' ||
        game.canControl === false ||
        game.phase !== 'deception' ||
        game.paused ||
        busy ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
      if (event.key === 'Enter' && target.closest('button,a') && !target.closest('.answer-options'))
        return;
      const index = Number(event.key) - 1;
      if (/^[1-5]$/.test(event.key) && game.options[index]) {
        event.preventDefault();
        setSelected(game.options[index].id);
      } else if (event.key === 'Enter' && selected) {
        event.preventDefault();
        void action('lock', selected);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [game, kind, busy, selected]);
  const seconds = game
    ? Math.max(
        0,
        Math.ceil(
          (game.paused ? game.remainingMs || 0 : game.deadline ? game.deadline - now : 0) / 1000,
        ),
      )
    : 0;
  if (!game)
    return (
      <main className="room-loading">
        <Brand />
        <div>
          {error ? (
            <>
              <CircleHelp size={30} />
              <h2>We couldn’t open this room.</h2>
              <p>{error}</p>
              <button className="button button-dark" onClick={() => navigate('/')}>
                Back to game hub
              </button>
            </>
          ) : (
            <>
              <LoaderCircle className="spin" size={30} />
              <p>Getting the show ready…</p>
            </>
          )}
        </div>
      </main>
    );
  const showOptions = game.options?.length > 0;
  const phaseDuration =
    game.phase === 'submission'
      ? game.config?.submissionSeconds || 30
      : game.phase === 'deception'
        ? game.config?.deceptionSeconds || 25
        : game.phase === 'selection'
          ? 5
          : game.phase === 'locked'
            ? 2.5
            : 10;
  const timerProgress = Math.min(100, Math.max(0, (seconds / phaseDuration) * 100));
  const stages = [
    { key: 'question', label: 'Question' },
    { key: 'submission', label: 'Write lies' },
    { key: 'selection', label: 'The mix' },
    { key: 'deception', label: 'Pick the truth' },
    { key: 'reveal', label: 'Reveal' },
  ];
  const stageIndex = game.phase === 'locked' ? 3 : stages.findIndex((x) => x.key === game.phase);
  const phase = game.phase;
  const reveal = game.reveal;
  const questionHidden = !isViewer && ['question', 'submission', 'selection'].includes(phase);
  const canHost = !isViewer && !isOverlay && game.canControl !== false;
  const modeName = modes.find((m) => m.id === game.mode)?.label || game.mode;
  const roomUrl = location.origin + '/play/' + id;
  const obsUrl = location.origin + '/overlay/' + id;
  return (
    <main
      className={`room-page ${isViewer ? 'viewer-page' : ''} ${isOverlay ? 'broadcast-page' : ''} phase-${phase} ${game.paused ? 'game-paused' : ''}`}
    >
      {isViewer && (
        <header className="viewer-header">
          <Brand />
          <span className="status-pill">
            <span />
            {connected ? 'LIVE ROOM' : 'RECONNECTING'}
          </span>
        </header>
      )}
      {!isOverlay && !isViewer && (
        <div className="room-heading">
          <div>
            <button className="back-link" onClick={() => navigate('/')}>
              <ArrowLeft size={14} />
              Game hub
            </button>
            <h1>
              {phase === 'lobby'
                ? 'Get the crew together'
                : phase === 'finished'
                  ? 'What a show'
                  : 'Trust your instincts'}
              <span>.</span>
            </h1>
            <p>
              {modeName} <span>·</span> {game.totalRounds} rounds <span>·</span>{' '}
              {game.aiMode === 'demo' ||
              game.aiMode === 'fallback' ||
              (me.demoEnabled && !me.aiConfigured)
                ? 'Demo · sample selection'
                : 'AI-assisted selection'}
            </p>
          </div>
          <div className="room-share">
            <button className="button button-outline" onClick={toggleSound} aria-pressed={soundEnabled}>{soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />} Sound {soundEnabled ? 'on' : 'off'}</button>
            <button className="button button-outline" onClick={() => copy(roomUrl)}><Link2 size={16} /> Invite players</button>
            <details className="show-menu"><summary><Settings2 size={17} /> Game menu</summary>
              <div className="show-menu-content">
                <button onClick={toggleSound}>{soundEnabled ? 'Turn sound off' : 'Turn sound on'}</button>
                <button onClick={() => copy(obsUrl)}>Copy OBS display link</button>
                {canHost && !['lobby','finished'].includes(phase) && <>
                  <button disabled={busy || phase === 'selection'} onClick={() => action(game.paused ? 'resume' : 'pause')}>{game.paused ? 'Resume show' : 'Pause show'}</button>
                  <button disabled={busy} onClick={() => { if(confirm('End this match and show the final score?')) action('end'); }}>End match</button>
                </>}
                {canHost && <ChatConnection me={me} id={id} notify={notify} />}
              </div>
            </details>
          </div>
        </div>
      )}
      <div className="room-columns">
        <section className="game-stage">
          <div className="stage-top">
            <span className="stage-wordmark">
              CHATDIDIT<span>✳</span>
            </span>
            <div className="stage-round-wrap">
              {['demo', 'fallback'].includes(game.aiMode || '') && (
                <span className="demo-stage-label">DEMO · SAMPLE GAME</span>
              )}
              <div className="stage-round">
                {phase === 'lobby'
                  ? 'THE SHOW STARTS HERE'
                  : `ROUND ${String(game.round).padStart(2, '0')} / ${String(game.totalRounds).padStart(2, '0')}`}
              </div>
            </div>
            <span className="live-label">
              <span />
              {game.paused ? 'PAUSED' : 'LIVE'}
            </span>
          </div>
          <div className="match-hud">
            <div className="hud-team chat-team">
              <span className="hud-team-icon">
                <MessageCircle size={24} />
              </span>
              <div>
                <span>TEAM CHAT</span>
                <strong>{game.scores.chat}</strong>
              </div>
              <span className="team-role">THE LIARS</span>
            </div>
            <div
              className={`countdown-ring ${seconds <= 5 && !['lobby', 'finished'].includes(phase) ? 'urgent' : ''}`}
              style={
                {
                  '--timer-progress': `${['lobby', 'finished'].includes(phase) ? 100 : timerProgress}%`,
                } as React.CSSProperties
              }
            >
              <div>
                <strong>
                  {phase === 'lobby' ? (
                    <Swords size={23} />
                  ) : phase === 'finished' ? (
                    <Trophy size={23} />
                  ) : (
                    String(seconds).padStart(2, '0')
                  )}
                </strong>
                <span>
                  {phase === 'lobby'
                    ? 'VS'
                    : phase === 'finished'
                      ? 'FINAL'
                      : game.paused
                        ? 'PAUSED'
                        : 'SECONDS'}
                </span>
              </div>
            </div>
            <div className="hud-team streamer-team">
              <span className="team-role">THE DETECTIVE</span>
              <div>
                <span>STREAMER</span>
                <strong>{game.scores.streamer}</strong>
              </div>
              <span className="hud-team-icon">
                <Twitch size={24} />
              </span>
            </div>
          </div>
          {!['lobby', 'finished'].includes(phase) && (
            <div className="phase-rail" aria-label="Round progress">
              {stages.map((stage, i) => (
                <div
                  key={stage.key}
                  className={`${i === stageIndex ? 'current' : ''} ${i < stageIndex ? 'complete' : ''}`}
                >
                  <span>{i < stageIndex ? <Check size={10} /> : i + 1}</span>
                  <strong>{stage.label}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="stage-body">
            <div className="round-eyebrow">
              {phase === 'reveal'
                ? !game.selectedOptionId || reveal?.fooled
                  ? 'CHAT DID IT!!'
                  : 'NICE TRY, CHAT.'
                : phase === 'finished'
                  ? 'THE FINAL SCORE'
                  : phase === 'lobby'
                    ? 'YOUR COMMUNITY. YOUR GAME SHOW.'
                    : modeName?.toUpperCase()}
            </div>
            {phase === 'lobby' ? (
              <div className="lobby-content">
                <div className="lobby-icon">
                  <MessageCircle size={50} />
                  <Sparkles size={24} />
                </div>
                <h2>
                  Your chat lies.
                  <br />
                  <em>You decide.</em>
                </h2>
                <p>
                  {isViewer
                    ? 'You’re in. Get your best lies ready.'
                    : 'The room is ready. Share the link, then start the show.'}
                </p>
                {canHost && <p className="lobby-auto-note">Invite your players above. Once you start, every round flows automatically.</p>}
                {canHost && (
                  <button
                    className="button button-lime"
                    disabled={busy}
                    onClick={() => action('start')}
                  >
                    <Play size={17} fill="currentColor" />
                    Start the show
                  </button>
                )}
              </div>
            ) : phase === 'finished' ? (
              <div className="finished-content">
                <Trophy size={48} />
                <h2>
                  {game.scores.chat === game.scores.streamer
                    ? 'A worthy conspiracy.'
                    : game.scores.chat > game.scores.streamer
                      ? 'CHAT DID IT!!'
                      : 'Truth wins this time.'}
                </h2>
                <p>
                  {game.scores.chat > game.scores.streamer
                    ? 'Never underestimate a chat with a plan.'
                    : 'The lies were good. The instincts were better.'}
                </p>
                <div className="final-score">
                  <div>
                    <span>TEAM CHAT</span>
                    <strong>{game.scores.chat}</strong>
                  </div>
                  <span>:</span>
                  <div>
                    <span>STREAMER</span>
                    <strong>{game.scores.streamer}</strong>
                  </div>
                </div>
                {!isOverlay && (
                  <button className="button button-lime" onClick={() => navigate('/')}>
                    Play again <ArrowRight size={17} />
                  </button>
                )}
              </div>
            ) : (
              <>
                <h2 className="stage-question">
                  {questionHidden ? 'Chat knows something you don’t.' : game.question?.prompt || 'The next question is on its way.'}
                </h2>
                {phase === 'submission' && (
                  <div className="submission-stage">
                    <div className="submission-orb">
                      <MessageCircle size={44} />
                      <span>?</span>
                    </div>
                    <h3>{isViewer ? 'Make it believable.' : 'Chat is cooking up a story.'}</h3>
                    <p>
                      {isViewer
                        ? 'Submit a convincing fake answer below.'
                        : 'The question is for chat’s eyes only. You’ll see it with the answers.'}
                    </p>
                    <div className="participant-count">
                      <Users size={18} />
                      <strong>{game.submissionCount.toLocaleString()}</strong>
                      <span>lies submitted</span>
                    </div>
                  </div>
                )}
                {phase === 'selection' && (
                  <div className="selection-state">
                    <LoaderCircle size={38} className="spin" />
                    <h3>
                      Separating the good lies
                      <br />
                      from the great ones.
                    </h3>
                    <p>Grouping similar answers and choosing the finalists.</p>
                  </div>
                )}
                {phase === 'question' && (
                  <div className="get-ready">
                    <Sparkles size={28} />
                    <p>{isViewer ? 'Read the question. Get your lie ready.' : 'Chat sees the question first. Your reveal is coming.'}</p>
                  </div>
                )}
                {showOptions && ['deception', 'locked', 'reveal'].includes(phase) && (
                  <div className="answer-options">
                    {game.options.map((o, i) => (
                      <button
                        key={o.id}
                        disabled={!canHost || phase !== 'deception' || busy || game.paused}
                        onClick={() => setSelected(o.id)}
                        className={`answer-option ${selected === o.id || game.selectedOptionId === o.id ? 'chosen' : ''} ${reveal?.correctOptionId === o.id ? 'correct' : ''} ${phase === 'reveal' && game.selectedOptionId === o.id && reveal?.correctOptionId !== o.id ? 'wrong' : ''}`}
                      >
                        <span>{i + 1}</span>
                        <strong>{o.text}</strong>
                        {reveal?.correctOptionId === o.id ? (
                          <CheckCircle2 size={21} />
                        ) : game.selectedOptionId === o.id ? (
                          <Flag size={18} />
                        ) : selected === o.id ? (
                          <CheckCircle2 size={20} />
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
                {canHost && phase === 'deception' && (
                  <button className="button button-lime stage-lock" onClick={() => action('lock', selected)} disabled={busy || !selected || game.paused}>
                    <ShieldCheck size={18} /> {selected ? 'Lock in my answer' : 'Choose an answer above'}
                  </button>
                )}
                {canHost && phase === 'deception' && (
                  <div className="keyboard-hint">
                    <span>
                      <kbd>1</kbd>–<kbd>5</kbd> choose
                    </span>
                    <span>
                      <kbd>↵</kbd> lock your answer
                    </span>
                  </div>
                )}
                {phase === 'locked' && (
                  <div className="locked-label">
                    <ShieldCheck size={17} />
                    YOUR ANSWER IS LOCKED. <span>Let’s see if chat got you.</span>
                  </div>
                )}
                {phase === 'reveal' && reveal && (
                  <div className={`reveal-note ${reveal.fooled || !game.selectedOptionId ? 'fooled' : ''}`}>
                    <div>
                      <span>
                        {!game.selectedOptionId || reveal.fooled ? 'CHAT +1' : 'STREAMER +1'}
                      </span>
                      <h3>
                        {!game.selectedOptionId
                          ? 'CHAT DID IT!!'
                          : reveal.fooled
                            ? 'CHAT DID IT!!'
                            : 'You found the truth.'}
                      </h3>
                    </div>
                    <p>{!game.selectedOptionId ? 'Time ran out. Chat takes the point. ' : reveal.fooled ? 'You believed the lie. ' : ''}{reveal.explanation}</p>
                    {reveal.contributors?.length > 0 && (
                      <div className="contributor-credit">
                        <Sparkles size={14} />
                        <span>
                          Lie credits:{' '}
                          {reveal.contributors
                            .slice(0, 4)
                            .map((c) =>
                              typeof c === 'string'
                                ? c
                                : (c as { displayName?: string }).displayName || 'Viewer',
                            )
                            .join(', ')}
                          {reveal.contributors.length > 4
                            ? ` +${reveal.contributors.length - 4} more`
                            : ''}
                        </span>
                      </div>
                    )}
                    {!isOverlay && (
                      <a href={reveal.sourceUrl} target="_blank" rel="noreferrer">
                        Check the source <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="stage-bottom game-stage-footer">
            <span>
              <ShieldCheck size={13} />
              TRUST YOUR INSTINCTS
            </span>
            <strong>{game.paused ? 'GAME PAUSED' : phaseLabels[phase]}</strong>
            <span>{game.submissionCount.toLocaleString()} LIES SUBMITTED</span>
          </div>
        </section>
        {!isOverlay && (
          <aside className="room-panel">
            {isViewer ? (
              <>
                <div className="panel-eyebrow">
                  <MessageCircle size={17} />
                  TEAM CHAT
                </div>
                <h3>
                  {phase === 'submission'
                    ? 'Lie like you mean it.'
                    : phase === 'deception'
                      ? 'Sell the story.'
                      : phase === 'reveal'
                        ? 'The truth comes out.'
                        : 'Ready to cause trouble?'}
                </h3>
                {phase === 'submission' ? (
                  <form onSubmit={submit}>
                    <p className="viewer-mobile-question">{game.question?.prompt}</p>
                    {submitted && (
                      <div className="submission-confirmation" role="status">
                        <CheckCircle2 size={31} />
                        <strong>Your lie is in.</strong>
                        <p>Keep a straight face. You can still edit before time runs out.</p>
                        <button
                          type="button"
                          onClick={() => {
                            setSubmitted(false);
                            setTimeout(() => document.getElementById('lie-answer')?.focus(), 0);
                          }}
                        >
                          Edit my answer <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                    <div className={submitted ? 'submitted-input-hidden' : ''}>
                      <label className="field-label" htmlFor="lie-answer">
                        Your fake answer
                      </label>
                      <textarea
                        id="lie-answer"
                        maxLength={140}
                        placeholder="Something believable. Something wrong."
                        value={answer}
                        onChange={(e) => {
                          setAnswer(e.target.value);
                          setSubmitted(false);
                        }}
                        disabled={busy || game.paused}
                      />
                      <div className="input-meta">
                        <span>Keep it clean. Make it convincing.</span>
                        <span>{answer.length}/140</span>
                      </div>
                      {!me.user && !me.demoEnabled ? (
                        <a
                          className="button button-dark full-width"
                          href={'/auth/twitch?returnTo=' + encodeURIComponent('/play/' + id)}
                        >
                          <Twitch size={17} />
                          Sign in to submit
                        </a>
                      ) : (
                        <button
                          className="button button-dark full-width"
                          disabled={!answer.trim() || busy || game.paused}
                        >
                          {busy ? (
                            <LoaderCircle className="spin" size={17} />
                          ) : submitted ? (
                            <Check size={17} />
                          ) : (
                            <Send size={17} />
                          )}{' '}
                          {submitted ? 'Submitted — update your lie' : 'Send your lie'}
                        </button>
                      )}
                    </div>
                    <p className="private-note">
                      <ShieldCheck size={13} />
                      Only the server can see your answer before selection.
                    </p>
                  </form>
                ) : (
                  <>
                    <p className="panel-description">
                      {phase === 'deception'
                        ? 'Head to Twitch chat and convince the streamer. All five options are on the table.'
                        : phase === 'reveal'
                          ? 'That’s one round in the books. Stay close — there are more lies to tell.'
                          : phase === 'finished'
                            ? 'Thanks for bringing the chaos. Your community made the show.'
                            : 'Stay on this page. When the submission timer starts, this is where you’ll write your answer.'}
                    </p>
                    <div className="viewer-wait">
                      <Users size={34} />
                      <span>You’re part of the conspiracy.</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="auto-show-cue" role="status">
                <span className="auto-show-badge"><Radio size={14} /> AUTOMATIC SHOW</span>
                <strong>{game.paused ? 'Show paused' : phase === 'lobby' ? 'Ready when you are' : phase === 'finished' ? 'That’s a wrap' : phase === 'deception' ? 'Your moment. Pick the truth.' : phase === 'reveal' ? (game.round >= game.totalRounds ? `Final scores in ${seconds}s` : `Next round in ${seconds}s`) : phase === 'submission' ? `Chat is writing · ${game.submissionCount} lies in` : phase === 'selection' ? 'Mixing truth with trouble…' : phase === 'locked' ? 'Here comes the truth…' : 'Chat gets a head start. Your question comes with the choices.'}</strong>
                {game.paused && canHost && <button className="button button-lime" onClick={() => action('resume')} disabled={busy}><Play size={16} /> Resume show</button>}
                {canHost && me.user?.demo && phase === 'submission' && <button className="button button-outline" disabled={busy || game.paused} onClick={async () => { setBusy(true); try { await api('/api/games/' + id + '/demo-audience', {}); } catch(e) { notify((e as Error).message); } finally { setBusy(false); } }}>Add demo audience</button>}
              </div>
            )}
            <div className="connection-line">
              <span className={connected ? 'connected' : ''} />
              {connected ? 'Live connection' : 'Reconnecting automatically'}
            </div>
          </aside>
        )}
      </div>
      {isViewer && (
        <footer className="viewer-footer">
          Your chat lies. You decide. <span>✳</span> ChatDidIt
        </footer>
      )}
    </main>
  );
}
function ChatConnection({
  me,
  id,
  notify,
}: {
  me: Me;
  id: string;
  notify: (text: string) => void;
}) {
  const [chat, setChat] = useState<{
    connected?: boolean;
    needsAuthorization?: boolean;
    status?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const realUser = me.user && !me.user.demo && !me.user.isDemo && !me.user.id.startsWith('demo-');
  useEffect(() => {
    if (!me.twitchConfigured || !realUser) return;
    api<{ connected?: boolean; needsAuthorization?: boolean; status?: string }>(
      '/api/twitch/chat-status',
    )
      .then(setChat)
      .catch(() => {});
  }, [me.twitchConfigured, me.user?.id]);
  async function connect() {
    if (!me.twitchConfigured) return;
    if (!realUser || chat?.needsAuthorization) {
      location.href = '/auth/twitch?chat=true&returnTo=' + encodeURIComponent('/host/' + id);
      return;
    }
    setBusy(true);
    try {
      const result = await api<{
        connected?: boolean;
        needsAuthorization?: boolean;
        status?: string;
      }>('/api/twitch/connect-chat', {});
      setChat(result);
      if (result.needsAuthorization) {
        location.href = '/auth/twitch?chat=true&returnTo=' + encodeURIComponent('/host/' + id);
        return;
      }
      notify(result.connected ? 'Twitch chat is connected.' : 'Twitch chat connection requested.');
    } catch (e) {
      const failure = e as Error & { code?: string; needsAuthorization?: boolean };
      if (failure.code === 'CHAT_AUTH_REQUIRED' || failure.needsAuthorization) {
        location.href = '/auth/twitch?chat=true&returnTo=' + encodeURIComponent('/host/' + id);
        return;
      }
      notify(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chat-connection">
      <span className="panel-eyebrow">
        <Twitch size={15} />
        TWITCH CHAT
      </span>
      <p>
        {chat?.connected
          ? 'Your channel’s chat events are connected.'
          : realUser
            ? 'Connect channel chat to bring the live conversation into your game.'
            : 'Connect Twitch when you’re ready to play with your community.'}
      </p>
      <button
        className="button button-outline full-width"
        disabled={!me.twitchConfigured || busy || chat?.connected}
        title={
          !me.twitchConfigured
            ? 'Add your Twitch app credentials to enable chat integration'
            : chat?.connected
              ? 'Twitch chat is connected'
              : 'Connect Twitch chat'
        }
        onClick={connect}
      >
        {busy ? (
          <LoaderCircle size={15} className="spin" />
        ) : chat?.connected ? (
          <CheckCircle2 size={15} />
        ) : (
          <Twitch size={15} />
        )}{' '}
        {chat?.connected ? 'Chat connected' : realUser ? 'Connect chat' : 'Connect Twitch'}
      </button>
      {!me.twitchConfigured && <small>Available after Twitch setup.</small>}
    </div>
  );
}
export default App;
