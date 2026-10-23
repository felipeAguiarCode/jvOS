import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { matchPlaylist } from "../lib/music/match";
import { searchQuery, STATIONS, type Station, type Track } from "../lib/music/stations";
import { parseYoutubeId, splitVideoTitle } from "../lib/music/youtube";
import { useStoredState } from "../lib/storage";

declare global {
  interface Window {
    /** Development-only: stands in for yt-dlp in the browser tests (returns a playable URL). */
    __JARVIS_MUSIC__?: { resolve: (track: Track) => string | Promise<string> };
  }
}

export type PlaybackStatus = "idle" | "resolving" | "playing" | "paused" | "error";
/** yt-dlp on this machine: not asked yet, absent, present, being downloaded. */
export type YtdlpState = "unknown" | "missing" | "ready" | "installing";

export interface Ytdlp {
  state: YtdlpState;
  version: string | null;
  /** Our own copy (the app can update it), not one found on PATH. */
  managed: boolean;
  /** 0..1 while downloading. */
  progress: number | null;
  error: string | null;
}

/** Seconds into the song and its length. */
export interface MusicTime {
  position: number;
  duration: number;
}

/**
 * The song's clock, outside React state: it ticks several times a second, and only what shows
 * the time (the player, the widgets) subscribes, not the whole app.
 */
export interface MusicClock {
  get: () => MusicTime;
  subscribe: (listener: () => void) => () => void;
}

function createClock() {
  let value: MusicTime = { position: 0, duration: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(change: Partial<MusicTime>) {
      const next = { ...value, ...change };
      if (next.position === value.position && next.duration === value.duration) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** Position and duration of the song playing, for the components that show them. */
export function useMusicTime(music: MusicPlayer): MusicTime {
  return useSyncExternalStore(music.clock.subscribe, music.clock.get);
}

export interface NowPlaying {
  station: Station;
  index: number;
  track: Track;
}

export interface MusicPlayer {
  /** The Vice City stations, then the user's playlists. */
  playlists: Station[];
  /** The playlist shown in the player (browsing does not change what plays). */
  stationId: string;
  /** Cursor in the shown playlist. */
  cursor: number;
  current: NowPlaying | null;
  status: PlaybackStatus;
  /** Read it with `useMusicTime`. */
  clock: MusicClock;
  volume: number;
  shuffle: boolean;
  error: string | null;
  ytdlp: Ytdlp;
  /** A play is waiting for yt-dlp: the player asks to download it. */
  needsYtdlp: boolean;
  select: (stationId: string) => void;
  setCursor: (index: number) => void;
  play: (stationId: string, index: number) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  seekTo: (fraction: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  /** Plays the playlist a spoken name points at; returns it, or null when none matches. */
  playNamed: (name: string) => Station | null;
  /** Plays the next (or previous) playlist that has songs; returns it. */
  stepPlaylist: (step: 1 | -1) => Station | null;
  /** A new, empty playlist (shown at once); returns its id. */
  createPlaylist: (name: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  /** Adds a YouTube link; returns an error message, or null when it was added. */
  addLink: (id: string, link: string) => string | null;
  removeTrack: (id: string, index: number) => void;
  installYtdlp: () => void;
  dismissYtdlp: () => void;
  refreshYtdlp: () => void;
}

interface MusicPrefs {
  stationId: string;
  cursor: number;
  volume: number;
  shuffle: boolean;
}

interface Resolved {
  url: string;
  title?: string;
  uploader?: string | null;
  duration: number | null;
}

interface InstallProgress {
  received: number;
  total: number;
}

const DEFAULT_PREFS: MusicPrefs = { stationId: "flash", cursor: 0, volume: 0.8, shuffle: false };
/** After a song fails to load, the next one starts after this long. */
const SKIP_DELAY_MS = 3000;
/** Consecutive failures before giving up (network down, yt-dlp broken). */
const MAX_FAILURES = 3;
/** "Anterior" this far into a song restarts it instead. */
const RESTART_AFTER_S = 3;
const MISSING = "yt-dlp-missing";
const BROWSER_ONLY = "Disponível no app desktop";
const MAX_NAME = 40;
const MAX_TRACKS = 500;

function parsePrefs(raw: unknown): MusicPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { stationId, cursor, volume, shuffle } = raw as Record<string, unknown>;
  return {
    // Checked against the playlists once they are known (user playlists live in their own key).
    stationId: typeof stationId === "string" ? stationId : DEFAULT_PREFS.stationId,
    cursor: typeof cursor === "number" && cursor >= 0 ? Math.floor(cursor) : 0,
    volume: typeof volume === "number" && volume >= 0 && volume <= 1 ? volume : DEFAULT_PREFS.volume,
    shuffle: typeof shuffle === "boolean" ? shuffle : DEFAULT_PREFS.shuffle,
  };
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function parsePlaylists(raw: unknown): Station[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item): Station[] => {
    if (!item || typeof item !== "object") return [];
    const { id, name, tracks } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id.startsWith("pl-") || !text(name, MAX_NAME)) return [];
    const clean = (Array.isArray(tracks) ? tracks : []).flatMap((track): Track[] => {
      const { videoId, artist, title } = (track ?? {}) as Record<string, unknown>;
      const parsed = typeof videoId === "string" ? parseYoutubeId(videoId) : null;
      return parsed ? [{ videoId: parsed, artist: text(artist, 120) || "YouTube", title: text(title, 200) || parsed }] : [];
    });
    return [{ id, name: text(name, MAX_NAME), genre: "Playlist", host: "você", tracks: clean.slice(0, MAX_TRACKS), custom: true }];
  });
}

async function resolve(track: Track): Promise<Resolved> {
  const stand = import.meta.env.DEV ? window.__JARVIS_MUSIC__ : undefined;
  if (stand) return { url: await stand.resolve(track), duration: null };
  if (!isTauri()) throw new Error(BROWSER_ONLY);
  return invoke<Resolved>("music_resolve", track.videoId ? { videoId: track.videoId } : { query: searchQuery(track) });
}

const newId = () => `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * jv_T4p3's playback: one audio element for the whole app, so the music goes on with the window
 * closed. Each song is looked up on YouTube by yt-dlp (in Rust) when it starts; only its audio
 * stream plays. The user's playlists (YouTube links) are kept in `jarvis.music.playlists`.
 */
export function useMusicPlayer({ onTrackStart }: { onTrackStart?: () => void } = {}): MusicPlayer {
  const [prefs, setPrefs] = useStoredState("jarvis.music", DEFAULT_PREFS, parsePrefs);
  const [custom, setCustom] = useStoredState<Station[]>("jarvis.music.playlists", [], parsePlaylists);
  const [current, setCurrent] = useState<NowPlaying | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [clock] = useState(createClock);
  const [error, setError] = useState<string | null>(null);
  const [ytdlp, setYtdlp] = useState<Ytdlp>({ state: "unknown", version: null, managed: false, progress: null, error: null });
  const [pending, setPending] = useState<{ stationId: string; index: number } | null>(null);

  const playlists = useMemo(() => [...STATIONS, ...custom], [custom]);
  // Read by the audio events and timers, which outlive renders.
  const latest = useRef({ playlists, prefs, current });
  latest.current = { playlists, prefs, current };
  const find = useCallback((id: string) => latest.current.playlists.find((playlist) => playlist.id === id), []);

  const audio = useRef<HTMLAudioElement | null>(null);
  /** Bumped by every play: a slow lookup that lost the race is dropped. */
  const request = useRef(0);
  const failures = useRef(0);
  const skipTimer = useRef(0);
  const started = useRef(onTrackStart);
  started.current = onTrackStart;

  const element = useCallback(() => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.preload = "auto";
    }
    return audio.current;
  }, []);

  const stepFrom = useCallback((from: NowPlaying, direction: 1 | -1): { stationId: string; index: number } => {
    // The playlist as it is now (songs may have been added or removed meanwhile).
    const station = latest.current.playlists.find((playlist) => playlist.id === from.station.id) ?? from.station;
    const count = station.tracks.length || 1;
    if (latest.current.prefs.shuffle && count > 1) {
      const offset = 1 + Math.floor(Math.random() * (count - 1));
      return { stationId: station.id, index: (from.index + offset) % count };
    }
    return { stationId: station.id, index: (from.index + direction + count) % count };
  }, []);

  const play = useCallback(
    (stationId: string, index: number) => {
      const station = find(stationId);
      const track = station?.tracks[index];
      if (!station || !track) return;
      window.clearTimeout(skipTimer.current);
      const id = ++request.current;
      const media = element();
      media.pause();
      setCurrent({ station, index, track });
      setPrefs((previous) => ({ ...previous, stationId, cursor: index }));
      setStatus("resolving");
      setError(null);
      clock.set({ position: 0, duration: 0 });
      void resolve(track).then(
        ({ url, duration: known }) => {
          if (id !== request.current) return;
          if (known) clock.set({ duration: known });
          media.src = url;
          media.volume = latest.current.prefs.volume;
          media.play().then(
            () => {
              failures.current = 0;
              started.current?.();
              // Warm the next lookup while this one plays.
              const following = station.tracks[(index + 1) % station.tracks.length];
              if (isTauri() && !latest.current.prefs.shuffle && following !== track) void resolve(following).catch(() => {});
            },
            (reason) => {
              if (id === request.current && media.error) {
                setStatus("error");
                setError(`Não foi possível tocar: ${String(reason)}`);
              }
            },
          );
        },
        (reason) => {
          if (id !== request.current) return;
          const message = String(reason instanceof Error ? reason.message : reason);
          if (message === MISSING) {
            setYtdlp((previous) => ({ ...previous, state: "missing" }));
            setPending({ stationId, index });
            setStatus("idle");
            setCurrent(null);
            return;
          }
          setStatus("error");
          setError(message);
          // A song that cannot be found is skipped, but not forever.
          failures.current += 1;
          if (message !== BROWSER_ONLY && failures.current < MAX_FAILURES && station.tracks.length > 1) {
            skipTimer.current = window.setTimeout(() => playRef.current(stationId, (index + 1) % station.tracks.length), SKIP_DELAY_MS);
          }
        },
      );
    },
    [element, find, setPrefs, clock],
  );
  const playRef = useRef(play);
  playRef.current = play;

  // The audio element drives the clock and the status.
  useEffect(() => {
    const media = element();
    const onTime = () => clock.set({ position: media.currentTime });
    const onDuration = () => Number.isFinite(media.duration) && clock.set({ duration: media.duration });
    const onPlay = () => setStatus("playing");
    const onPause = () => setStatus((previous) => (previous === "playing" ? "paused" : previous));
    const onEnded = () => {
      const from = latest.current.current;
      if (!from) return;
      const next = stepFrom(from, 1);
      playRef.current(next.stationId, next.index);
    };
    const onError = () => {
      if (!media.currentSrc) return;
      setStatus("error");
      setError("O stream de áudio falhou");
    };
    media.addEventListener("timeupdate", onTime);
    media.addEventListener("durationchange", onDuration);
    media.addEventListener("playing", onPlay);
    media.addEventListener("pause", onPause);
    media.addEventListener("ended", onEnded);
    media.addEventListener("error", onError);
    return () => {
      media.removeEventListener("timeupdate", onTime);
      media.removeEventListener("durationchange", onDuration);
      media.removeEventListener("playing", onPlay);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("error", onError);
    };
  }, [element, stepFrom, clock]);

  // The app going away stops the music.
  useEffect(
    () => () => {
      window.clearTimeout(skipTimer.current);
      audio.current?.pause();
    },
    [],
  );

  useEffect(() => {
    if (audio.current) audio.current.volume = prefs.volume;
  }, [prefs.volume]);

  const refreshYtdlp = useCallback(() => {
    if (!isTauri()) return;
    void invoke<{ ytdlp: "missing" | "ready" | "installing"; version: string | null; managed: boolean }>("music_status").then(
      ({ ytdlp: state, version, managed }) => setYtdlp((previous) => ({ ...previous, state, version, managed })),
      () => {},
    );
  }, []);

  // Download progress and the end of it; a play that was waiting starts then.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    if (!isTauri()) return;
    const subscriptions = [
      listen<InstallProgress>("music:install-progress", ({ payload }) =>
        setYtdlp((previous) => ({ ...previous, state: "installing", progress: payload.total ? payload.received / payload.total : 0 })),
      ),
      listen<{ version: string | null; error: string | null }>("music:install-done", ({ payload }) => {
        if (payload.error) {
          setYtdlp((previous) => ({ ...previous, state: previous.version ? "ready" : "missing", progress: null, error: payload.error }));
          return;
        }
        setYtdlp({ state: "ready", version: payload.version, managed: true, progress: null, error: null });
        const waiting = pendingRef.current;
        setPending(null);
        if (waiting) playRef.current(waiting.stationId, waiting.index);
      }),
    ];
    return () => subscriptions.forEach((subscription) => void subscription.then((stop) => stop()));
  }, []);

  const installYtdlp = useCallback(() => {
    if (!isTauri()) return;
    setYtdlp((previous) => ({ ...previous, state: "installing", progress: 0, error: null }));
    void invoke("music_install").catch((reason) => setYtdlp((previous) => ({ ...previous, state: "missing", progress: null, error: String(reason) })));
  }, []);

  const shown = find(prefs.stationId) ?? STATIONS[0];
  const cursor = Math.min(prefs.cursor, Math.max(0, shown.tracks.length - 1));

  const pause = useCallback(() => audio.current?.pause(), []);

  const resume = useCallback(() => {
    const { current: now, prefs: settings } = latest.current;
    const media = audio.current;
    if (!now) {
      const station = find(settings.stationId) ?? STATIONS[0];
      return play(station.id, Math.min(settings.cursor, Math.max(0, station.tracks.length - 1)));
    }
    if (status === "error") return play(now.station.id, now.index);
    if (media && media.paused && status !== "resolving") void media.play();
  }, [find, play, status]);

  const toggle = useCallback(() => {
    if (status === "playing") pause();
    else resume();
  }, [status, pause, resume]);

  const next = useCallback(() => {
    const now = latest.current.current;
    if (!now) return resume();
    const target = stepFrom(now, 1);
    play(target.stationId, target.index);
  }, [stepFrom, play, resume]);

  const prev = useCallback(() => {
    const media = audio.current;
    const now = latest.current.current;
    if (!now) return;
    if (media && media.currentTime > RESTART_AFTER_S) {
      media.currentTime = 0;
      return;
    }
    const target = stepFrom(now, -1);
    play(target.stationId, target.index);
  }, [stepFrom, play]);

  const seekTo = useCallback((fraction: number) => {
    const media = audio.current;
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
    media.currentTime = Math.min(Math.max(fraction, 0), 0.999) * media.duration;
  }, []);

  const seek = useCallback((seconds: number) => {
    const media = audio.current;
    if (!media || !Number.isFinite(media.duration)) return;
    media.currentTime = Math.min(Math.max(media.currentTime + seconds, 0), Math.max(media.duration - 0.5, 0));
  }, []);

  const select = useCallback(
    (stationId: string) => {
      if (!find(stationId)) return;
      const now = latest.current.current;
      // Back on the playing playlist, the cursor goes to the song that plays.
      setPrefs((previous) => ({ ...previous, stationId, cursor: now?.station.id === stationId ? now.index : 0 }));
    },
    [find, setPrefs],
  );

  const setCursor = useCallback(
    (index: number) =>
      setPrefs((previous) => {
        const count = find(previous.stationId)?.tracks.length || 1;
        return { ...previous, cursor: (index + count) % count };
      }),
    [find, setPrefs],
  );

  const startPlaylist = useCallback(
    (station: Station) => {
      if (!station.tracks.length) {
        select(station.id);
        return;
      }
      const index = latest.current.prefs.shuffle ? Math.floor(Math.random() * station.tracks.length) : 0;
      play(station.id, index);
    },
    [play, select],
  );

  const playNamed = useCallback(
    (name: string) => {
      const station = matchPlaylist(name, latest.current.playlists);
      if (station) startPlaylist(station);
      return station ?? null;
    },
    [startPlaylist],
  );

  const stepPlaylist = useCallback(
    (step: 1 | -1) => {
      const { playlists: all, current: now, prefs: settings } = latest.current;
      const from = all.findIndex((playlist) => playlist.id === (now?.station.id ?? settings.stationId));
      for (let offset = 1; offset <= all.length; offset++) {
        const station = all[(from + step * offset + all.length * offset) % all.length];
        if (station.tracks.length) {
          startPlaylist(station);
          return station;
        }
      }
      return null;
    },
    [startPlaylist],
  );

  const createPlaylist = useCallback(
    (name: string) => {
      const id = newId();
      const clean = name.trim().slice(0, MAX_NAME) || `Playlist ${custom.length + 1}`;
      setCustom((previous) => [...previous, { id, name: clean, genre: "Playlist", host: "você", tracks: [], custom: true }]);
      setPrefs((previous) => ({ ...previous, stationId: id, cursor: 0 }));
      return id;
    },
    [custom.length, setCustom, setPrefs],
  );

  const renamePlaylist = useCallback(
    (id: string, name: string) => {
      const clean = name.trim().slice(0, MAX_NAME);
      if (clean) setCustom((previous) => previous.map((playlist) => (playlist.id === id ? { ...playlist, name: clean } : playlist)));
    },
    [setCustom],
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      setCustom((previous) => previous.filter((playlist) => playlist.id !== id));
      if (latest.current.prefs.stationId === id) setPrefs((previous) => ({ ...previous, stationId: STATIONS[0].id, cursor: 0 }));
      // The song that plays from it stops with it.
      if (latest.current.current?.station.id === id) {
        request.current++;
        audio.current?.pause();
        setCurrent(null);
        setStatus("idle");
      }
    },
    [setCustom, setPrefs],
  );

  const updateTrack = useCallback(
    (id: string, videoId: string, change: Partial<Track>) =>
      setCustom((previous) =>
        previous.map((playlist) =>
          playlist.id === id ? { ...playlist, tracks: playlist.tracks.map((track) => (track.videoId === videoId ? { ...track, ...change } : track)) } : playlist,
        ),
      ),
    [setCustom],
  );

  const addLink = useCallback(
    (id: string, link: string) => {
      const playlist = custom.find((item) => item.id === id);
      if (!playlist) return "Só dá para adicionar links às suas playlists";
      const videoId = parseYoutubeId(link);
      if (!videoId) return "Isso não parece um link do YouTube";
      if (playlist.tracks.some((track) => track.videoId === videoId)) return "Esse vídeo já está na playlist";
      if (playlist.tracks.length >= MAX_TRACKS) return `Limite de ${MAX_TRACKS} músicas por playlist`;
      setCustom((previous) =>
        previous.map((item) => (item.id === id ? { ...item, tracks: [...item.tracks, { videoId, artist: "YouTube", title: `youtu.be/${videoId}` }] } : item)),
      );
      // The title and channel come from the video itself (and its stream gets warmed).
      if (isTauri())
        void invoke<Resolved>("music_resolve", { videoId }).then(
          ({ title, uploader }) => title && updateTrack(id, videoId, splitVideoTitle(title, uploader)),
          () => {},
        );
      return null;
    },
    [custom, setCustom, updateTrack],
  );

  const removeTrack = useCallback(
    (id: string, index: number) => {
      setCustom((previous) => previous.map((item) => (item.id === id ? { ...item, tracks: item.tracks.filter((_, at) => at !== index) } : item)));
      setPrefs((previous) => (previous.stationId === id && previous.cursor >= index && previous.cursor > 0 ? { ...previous, cursor: previous.cursor - 1 } : previous));
    },
    [setCustom, setPrefs],
  );

  const setVolume = useCallback((volume: number) => setPrefs((previous) => ({ ...previous, volume: Math.min(1, Math.max(0, Math.round(volume * 100) / 100)) })), [setPrefs]);
  const toggleShuffle = useCallback(() => setPrefs((previous) => ({ ...previous, shuffle: !previous.shuffle })), [setPrefs]);
  const dismissYtdlp = useCallback(() => setPending(null), []);

  return useMemo(
    () => ({
      playlists,
      stationId: shown.id,
      cursor,
      current,
      status,
      clock,
      volume: prefs.volume,
      shuffle: prefs.shuffle,
      error,
      ytdlp,
      needsYtdlp: pending !== null,
      select,
      setCursor,
      play,
      toggle,
      pause,
      resume,
      next,
      prev,
      seek,
      seekTo,
      setVolume,
      toggleShuffle,
      playNamed,
      stepPlaylist,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addLink,
      removeTrack,
      installYtdlp,
      dismissYtdlp,
      refreshYtdlp,
    }),
    [
      playlists, shown.id, cursor, current, status, clock, prefs.volume, prefs.shuffle, error, ytdlp, pending, select, setCursor, play,
      toggle, pause, resume, next, prev, seek, seekTo, setVolume, toggleShuffle, playNamed, stepPlaylist, createPlaylist, renamePlaylist,
      deletePlaylist, addLink, removeTrack, installYtdlp, dismissYtdlp, refreshYtdlp,
    ],
  );
}
