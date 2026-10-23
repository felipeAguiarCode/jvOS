import type { KeyboardEvent } from "react";
import { useMusicTime, type MusicPlayer } from "../../../hooks/useMusicPlayer";
import { useTapeTick } from "../../../hooks/useTapeTick";
import { cassette } from "../../../lib/music/cassette";
import { musicKeys, nowLabel } from "../musicParts";

/**
 * "Fita": just jv_T4p3's cassette, turning while the music plays. A click (or Space) plays or
 * pauses; n and b skip.
 */
export function TapeWidget({ music, paused }: { music: MusicPlayer; paused: boolean }) {
  const playing = music.status === "playing";
  const tick = useTapeTick(playing, paused);
  const station = music.current?.station ?? music.playlists.find((item) => item.id === music.stationId);
  const { position, duration } = useMusicTime(music);
  const progress = duration > 0 ? position / duration : 0;
  const tape = cassette({ tick, progress, label: station?.name ?? "jv_T4p3", sublabel: nowLabel(music) });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const action = musicKeys(music)[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div tabIndex={0} onKeyDown={onKeyDown} className="flex h-full items-center justify-center px-1 font-mono outline-none">
      <button type="button" aria-label={playing ? "Pausar a música" : "Tocar a música"} onClick={music.toggle} className="cursor-pointer outline-none">
        <pre
          data-testid="tape-widget"
          aria-hidden
          className={`leading-[1.15] transition-colors ${playing ? "text-hud-light" : "text-hud-text/60"}`}
          // 48 columns of Consolas (0.55 em each) across the window.
          style={{ fontSize: "min(13px, calc((100cqw - 8px) / 26.4))" }}
        >
          {tape.join("\n")}
        </pre>
      </button>
    </div>
  );
}
