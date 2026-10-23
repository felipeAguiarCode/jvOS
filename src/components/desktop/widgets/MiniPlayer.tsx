import type { KeyboardEvent } from "react";
import { useMusicTime, type MusicPlayer } from "../../../hooks/useMusicPlayer";
import { clock, musicKeys, ProgressBar } from "../musicParts";
import { KeyHint } from "./tui";

/** "Mini player": what jv_T4p3 plays, how far along, and the three buttons that matter. */
export function MiniPlayer({ music }: { music: MusicPlayer }) {
  const { current, status } = music;
  const playing = status === "playing";
  const { position, duration } = useMusicTime(music);
  const progress = duration > 0 ? position / duration : 0;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.key === " " || event.key === "Enter") && (event.target as HTMLElement).closest("button")) return;
    const action = musicKeys(music)[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div tabIndex={0} onKeyDown={onKeyDown} data-testid="mini-player" className="flex h-full flex-col justify-center gap-1.5 px-3 py-2 font-mono text-[12px] outline-none">
      <div className="flex items-baseline gap-2">
        <span className={playing ? "text-hud-light" : "text-hud-text/50"}>♪</span>
        <span className="min-w-0 flex-1 truncate font-semibold text-hud-light">
          {status === "resolving" ? "sintonizando…" : status === "error" ? <span className="text-hud-alert">{music.error}</span> : (current?.track.title ?? "Nada tocando")}
        </span>
        <span className="shrink-0 tabular-nums text-hud-text/70">
          {clock(position)} / {clock(duration)}
        </span>
      </div>
      <div className="truncate pl-[2ch] text-hud-text/50">
        {current ? `${current.track.artist} · ${current.station.name}` : "jv_T4p3 · espaço toca a playlist escolhida"}
      </div>
      <ProgressBar value={progress} onSeek={music.seekTo} className="h-1.5" />
      <div className="flex items-center gap-3 pt-0.5">
        <KeyHint hotkey="b" label="Música anterior" action="anterior" onClick={music.prev} />
        <KeyHint hotkey="espaço" label={playing ? "Pausar" : "Tocar"} action={playing ? "pausar" : "tocar"} onClick={music.toggle} />
        <KeyHint hotkey="n" label="Próxima música" action="próxima" onClick={music.next} />
        <span className="ml-auto text-[11px] tabular-nums text-hud-text/45">vol {Math.round(music.volume * 100)}%</span>
      </div>
    </div>
  );
}
