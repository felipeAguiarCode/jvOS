import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMusicTime, type MusicPlayer } from "../../../hooks/useMusicPlayer";
import { useTapeTick } from "../../../hooks/useTapeTick";
import { cassette } from "../../../lib/music/cassette";
import type { Station } from "../../../lib/music/stations";
import { clock, nowLabel, ProgressBar } from "../musicParts";
import { BlockBar, KeyHint } from "../widgets/tui";

const VOLUME_STEP = 0.05;
const SEEK_STEP = 10;
/** A message under the link field stays this long. */
const NOTE_MS = 4000;

/**
 * jv_T4p3: a terminal music player (after youtube-music-cli). Its playlists are GTA: Vice City's
 * radio stations plus the user's own, made of pasted YouTube links. Playlists on the left, the
 * songs on the right, the cassette below them, "Tocando agora" at the bottom; everything is
 * reachable from the keyboard.
 */
export function TapePlayer({ music, paused }: { music: MusicPlayer; paused: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  /** A playlist was just created: its link field takes the focus once it shows. */
  const focusLink = useRef(false);
  /** Naming a new playlist, renaming the shown one, or confirming its deletion. */
  const [editing, setEditing] = useState<"create" | "rename" | "delete" | null>(null);
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const station = music.playlists.find((item) => item.id === music.stationId) ?? music.playlists[0];
  const { current, status } = music;
  const playing = status === "playing";
  const tick = useTapeTick(playing, paused);
  const { position, duration } = useMusicTime(music);
  const radios = music.playlists.filter((item) => !item.custom);
  const mine = music.playlists.filter((item) => item.custom);

  const { refreshYtdlp } = music;
  useEffect(() => refreshYtdlp(), [refreshYtdlp]);

  // The cursor stays in view.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${music.cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [music.cursor, music.stationId]);

  useEffect(() => root.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  // Runs in the commit of the Enter that created it, so the next keystrokes land in the field.
  useEffect(() => {
    if (!focusLink.current || !station.custom) return;
    focusLink.current = false;
    linkField.current?.focus();
  }, [station.id, station.custom]);

  // Switching playlists cancels a rename or a deletion in progress.
  useEffect(() => setEditing((mode) => (mode === "create" ? mode : null)), [music.stationId]);

  const focusPlayer = () => root.current?.focus({ preventScroll: true });

  const shift = (step: 1 | -1) => {
    const index = music.playlists.findIndex((item) => item.id === station.id);
    music.select(music.playlists[(index + step + music.playlists.length) % music.playlists.length].id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    // Fields type; a focused button handles its own Enter and Space.
    if (target.closest("input")) return;
    if ((event.key === "Enter" || event.key === " ") && target.closest("button")) return;
    const actions: Record<string, () => void> = {
      ArrowUp: () => music.setCursor(music.cursor - 1),
      ArrowDown: () => music.setCursor(music.cursor + 1),
      ArrowLeft: () => shift(-1),
      ArrowRight: () => shift(1),
      Enter: () => station.tracks.length && music.play(station.id, music.cursor),
      " ": music.toggle,
      n: music.next,
      b: music.prev,
      ",": () => music.seek(-SEEK_STEP),
      ".": () => music.seek(SEEK_STEP),
      "-": () => music.setVolume(music.volume - VOLUME_STEP),
      "+": () => music.setVolume(music.volume + VOLUME_STEP),
      "=": () => music.setVolume(music.volume + VOLUME_STEP),
      s: music.toggleShuffle,
      p: () => setEditing("create"),
      a: () => linkField.current?.focus(),
      Delete: () => station.custom && station.tracks.length && music.removeTrack(station.id, music.cursor),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const progress = duration > 0 ? position / duration : 0;
  const tape = cassette({ tick, progress, label: (current?.station ?? station).name, sublabel: nowLabel(music) });
  const askYtdlp = music.needsYtdlp || music.ytdlp.state === "installing";

  return (
    <div
      ref={root}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest("button, input")) focusPlayer();
      }}
      data-testid="tape-player"
      className="flex h-full flex-col gap-2 p-2 font-mono text-[12.5px] leading-snug text-hud-text outline-none select-none"
    >
      <Box className="py-1 text-center text-[14px] font-semibold text-hud-light">♪ ► jv_T4p3 ► ♪</Box>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,28%)_1fr] gap-2">
        <Box title="≡ Rádios" className="min-h-0">
          <div role="listbox" aria-label="Playlists" className="hud-scroll min-h-0 flex-1 overflow-y-auto">
            {radios.map((item) => (
              <PlaylistRow key={item.id} playlist={item} music={music} />
            ))}
            <div className="mt-2 mb-1 font-semibold text-hud-cyan" aria-hidden>
              ♫ Minhas playlists
            </div>
            {mine.map((item) => (
              <PlaylistRow key={item.id} playlist={item} music={music} />
            ))}
            {editing === "create" ? (
              <NameField
                label="Nome da nova playlist"
                initial=""
                onDone={(name) => {
                  setEditing(null);
                  if (name !== null) {
                    focusLink.current = true;
                    music.createPlaylist(name);
                  } else focusPlayer();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing("create")}
                className="w-full cursor-pointer px-2 py-[3px] text-left text-hud-text/55 outline-none hover:text-hud-light focus-visible:text-hud-light"
              >
                + nova playlist
              </button>
            )}
          </div>
          <p className="mt-2 border-t border-hud-cyan/15 pt-2 text-[11px] text-hud-text/45">
            {station.custom ? `${station.tracks.length} ${station.tracks.length === 1 ? "link" : "links"} do YouTube` : station.genre}
            <br />
            {station.custom ? "sua playlist" : `DJ ${station.host}`}
          </p>
        </Box>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2">
          <Box
            title={editing === "rename" ? undefined : `♫ ${station.name}`}
            aside={station.custom ? undefined : `${station.tracks.length} faixas`}
            actions={
              station.custom &&
              editing !== "rename" && (
                <span className="flex gap-2 text-[11px] font-normal">
                  {editing === "delete" ? (
                    <>
                      <span className="text-hud-alert">apagar “{station.name}”?</span>
                      <TextButton
                        tone="alert"
                        onClick={() => {
                          setEditing(null);
                          music.deletePlaylist(station.id);
                          focusPlayer();
                        }}
                      >
                        [s] sim
                      </TextButton>
                      <TextButton onClick={() => setEditing(null)}>[n] não</TextButton>
                    </>
                  ) : (
                    <>
                      <TextButton onClick={() => setEditing("rename")}>renomear</TextButton>
                      <TextButton onClick={() => setEditing("delete")}>apagar</TextButton>
                    </>
                  )}
                </span>
              )
            }
            className="min-h-0"
          >
            {editing === "rename" && (
              <NameField
                label="Novo nome da playlist"
                initial={station.name}
                onDone={(name) => {
                  setEditing(null);
                  if (name) music.renamePlaylist(station.id, name);
                  focusPlayer();
                }}
              />
            )}
            {station.custom && (
              <form
                className="mb-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const field = linkField.current;
                  if (!field?.value.trim()) return;
                  const problem = music.addLink(station.id, field.value);
                  setNote(problem ? { text: problem, tone: "error" } : { text: "Adicionado. O título vem do próprio vídeo.", tone: "info" });
                  if (!problem) field.value = "";
                }}
              >
                <label className="flex items-center gap-2 border border-hud-cyan/25 px-2 py-1 focus-within:border-hud-light/60">
                  <span className="text-hud-light">+</span>
                  <input
                    ref={linkField}
                    aria-label="Link do YouTube"
                    placeholder="cole um link do YouTube e aperte Enter"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") focusPlayer();
                    }}
                    className="min-w-0 flex-1 bg-transparent text-hud-text outline-none select-text placeholder:text-hud-text/35"
                  />
                </label>
                {note && (
                  <p role="status" className={`mt-1 text-[11px] ${note.tone === "error" ? "text-hud-alert" : "text-hud-text/55"}`}>
                    {note.text}
                  </p>
                )}
              </form>
            )}
            <div ref={list} role="listbox" aria-label={`Músicas de ${station.name}`} className="hud-scroll min-h-0 flex-1 overflow-y-auto">
              {station.custom && !station.tracks.length && (
                <p className="px-2 py-1 text-hud-text/45">Playlist vazia: cole um link do YouTube acima (youtube.com/watch, youtu.be, shorts, Music).</p>
              )}
              {station.tracks.map((track, index) => {
                const onAir = current?.station.id === station.id && current.index === index;
                const atCursor = index === music.cursor;
                return (
                  <div
                    key={track.videoId ?? `${track.artist}-${track.title}`}
                    role="option"
                    data-index={index}
                    aria-selected={atCursor}
                    aria-current={onAir || undefined}
                    onClick={() => music.setCursor(index)}
                    onDoubleClick={() => music.play(station.id, index)}
                    className={`group flex cursor-pointer items-center gap-2 px-2 py-[2px] ${atCursor ? "bg-hud-cyan/12" : "hover:bg-hud-cyan/[0.06]"}`}
                  >
                    <span className="w-[1ch] shrink-0 text-hud-light">{onAir ? "►" : ""}</span>
                    <span className={`min-w-0 flex-1 truncate ${onAir ? "text-hud-light" : ""}`}>
                      <span className={`font-semibold ${onAir ? "" : "text-hud-text"}`}>{track.title}</span>
                      <span className="text-hud-text/45"> — {track.artist}</span>
                    </span>
                    {station.custom && (
                      <button
                        type="button"
                        aria-label={`Remover ${track.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          music.removeTrack(station.id, index);
                        }}
                        className={`shrink-0 cursor-pointer px-1 text-hud-text/50 outline-none hover:text-hud-alert focus-visible:text-hud-alert ${
                          atCursor ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        }`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Box>

          <Box title="▪ Fita" aside={music.shuffle ? "aleatório" : undefined}>
            {askYtdlp ? (
              <YtdlpPrompt music={music} />
            ) : (
              <pre data-testid="cassette" aria-hidden className="mx-auto overflow-hidden text-[12px] leading-[1.2] text-hud-light">
                {tape.join("\n")}
              </pre>
            )}
          </Box>
        </div>
      </div>

      <Box>
        <div className="flex items-center gap-3">
          <span className="text-hud-text/50">▌</span>
          <span className="min-w-0 flex-1 truncate" role="status" aria-live="polite">
            {status === "error" ? (
              <span className="text-hud-alert">Erro: {music.error}</span>
            ) : current ? (
              <>
                <span className="text-hud-text/60">{status === "resolving" ? "Sintonizando: " : status === "paused" ? "Pausado: " : "Tocando agora: "}</span>
                <span className="text-hud-light">{current.track.title}</span>
                <span className="text-hud-text/60"> — {current.track.artist}</span>
              </>
            ) : (
              <span className="text-hud-text/45">Nada tocando · escolha uma playlist e aperte Enter</span>
            )}
          </span>
          <span data-testid="music-time" className="shrink-0 tabular-nums text-hud-text">
            {clock(position)} / {clock(duration)}
          </span>
        </div>
        <ProgressBar value={progress} onSeek={music.seekTo} />
      </Box>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <KeyHint hotkey="espaço" label={playing ? "Pausar" : "Tocar"} action={playing ? "pausar" : "tocar"} onClick={music.toggle} />
        <KeyHint hotkey="b" label="Música anterior" action="anterior" onClick={music.prev} />
        <KeyHint hotkey="n" label="Próxima música" action="próxima" onClick={music.next} />
        <KeyHint hotkey="," label="Voltar 10 segundos" action="-10s" onClick={() => music.seek(-SEEK_STEP)} />
        <KeyHint hotkey="." label="Avançar 10 segundos" action="+10s" onClick={() => music.seek(SEEK_STEP)} />
        <KeyHint hotkey="-" label="Diminuir o volume" action="vol" onClick={() => music.setVolume(music.volume - VOLUME_STEP)} />
        <KeyHint hotkey="+" label="Aumentar o volume" action="vol" onClick={() => music.setVolume(music.volume + VOLUME_STEP)} />
        <KeyHint hotkey="s" label="Ordem aleatória" action={music.shuffle ? "aleatório: on" : "aleatório: off"} onClick={music.toggleShuffle} />
        <KeyHint hotkey="p" label="Nova playlist" action="nova playlist" onClick={() => setEditing("create")} />
        {station.custom && <KeyHint hotkey="a" label="Adicionar link do YouTube" action="link" onClick={() => linkField.current?.focus()} />}
        <span className="text-[11px] text-hud-text/40">↑↓ músicas · ←→ playlists · Enter toca{station.custom ? " · Del remove" : ""}</span>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-hud-text/60">
          {music.ytdlp.managed && music.ytdlp.state === "ready" && (
            <TextButton onClick={music.installYtdlp}>atualizar yt-dlp{music.ytdlp.version ? ` (${music.ytdlp.version})` : ""}</TextButton>
          )}
          <span data-testid="music-volume" className="tabular-nums">vol {Math.round(music.volume * 100)}%</span>
        </span>
      </div>
    </div>
  );
}

function PlaylistRow({ playlist, music }: { playlist: Station; music: MusicPlayer }) {
  const shown = playlist.id === music.stationId;
  const onAir = music.current?.station.id === playlist.id;
  return (
    <div
      role="option"
      aria-selected={shown}
      onClick={() => music.select(playlist.id)}
      onDoubleClick={() => playlist.tracks.length && music.play(playlist.id, 0)}
      className={`flex cursor-pointer items-center justify-between gap-2 px-2 py-[3px] ${shown ? "bg-hud-light/85 font-semibold text-hud-void" : "hover:bg-hud-cyan/10"}`}
    >
      <span className="truncate">{playlist.name}</span>
      {onAir && <span aria-label="no ar">{music.status === "playing" ? "♪" : "·"}</span>}
    </div>
  );
}

/** One-line field for a playlist's name: Enter saves, Esc cancels (null). */
function NameField({ label, initial, onDone }: { label: string; initial: string; onDone: (name: string | null) => void }) {
  const field = useRef<HTMLInputElement>(null);
  // Enter, Esc and the blur of the field going away must not answer twice.
  const answered = useRef(false);
  const finish = (name: string | null) => {
    if (answered.current) return;
    answered.current = true;
    onDone(name);
  };
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return (
    <input
      ref={field}
      aria-label={label}
      defaultValue={initial}
      maxLength={40}
      placeholder="nome da playlist"
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value.trim() || null);
        if (event.key === "Escape") finish(null);
      }}
      onBlur={(event) => finish(event.currentTarget.value.trim() || null)}
      className="mb-1 w-full border border-hud-light/50 bg-transparent px-2 py-[2px] text-hud-text outline-none select-text placeholder:text-hud-text/35"
    />
  );
}

function TextButton({ onClick, tone, children }: { onClick: () => void; tone?: "alert"; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer outline-none ${tone === "alert" ? "text-hud-alert hover:underline" : "text-hud-text/60 hover:text-hud-light focus-visible:text-hud-light"}`}
    >
      {children}
    </button>
  );
}

/** A panel with a thin rounded border and an optional title, as in youtube-music-cli. */
function Box({ title, aside, actions, className = "", children }: { title?: string; aside?: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col rounded-md border border-hud-cyan/35 px-3 py-2 ${className}`}>
      {(title || aside || actions) && (
        <h3 className="mb-1.5 flex items-center justify-between gap-2 font-semibold text-hud-cyan">
          <span className="truncate">{title}</span>
          {actions}
          {aside && <span className="shrink-0 text-[11px] font-normal text-hud-text/45">{aside}</span>}
        </h3>
      )}
      {children}
    </section>
  );
}

/** Asked on the first play when yt-dlp is not on this machine; shows the download as it goes. */
function YtdlpPrompt({ music }: { music: MusicPlayer }) {
  const { ytdlp } = music;
  if (ytdlp.state === "installing") {
    return (
      <div className="space-y-2 py-2">
        <p>Baixando o yt-dlp oficial (GitHub) e conferindo o SHA-256…</p>
        <BlockBar value={ytdlp.progress ?? 0} cells={30} label="Download do yt-dlp" />
      </div>
    );
  }
  return (
    <div role="alertdialog" aria-label="Baixar o yt-dlp" className="space-y-2 py-2">
      <p>
        O jv_T4p3 usa o <span className="text-hud-light">yt-dlp</span> (~18 MB) para achar cada música no YouTube e tocar só o áudio.
      </p>
      <p className="text-hud-text/50">Ele fica na pasta do JARVIS e pode ser atualizado daqui.</p>
      {ytdlp.error && <p className="text-hud-alert">{ytdlp.error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={music.installYtdlp}
          className="cursor-pointer bg-hud-light/85 px-2 font-semibold text-hud-void outline-none hover:bg-hud-light focus-visible:ring-1 focus-visible:ring-hud-light"
        >
          [ Baixar ]
        </button>
        <button type="button" onClick={music.dismissYtdlp} className="cursor-pointer px-2 text-hud-text/60 outline-none hover:text-hud-light focus-visible:text-hud-light">
          [ Agora não ]
        </button>
      </div>
    </div>
  );
}
