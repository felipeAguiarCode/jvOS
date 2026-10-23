import type { PointerEvent } from "react";
import type { MusicPlayer } from "../../hooks/useMusicPlayer";

/** Pieces shared by jv_T4p3 and its widgets (Fita, Mini player). */

/** The progress bar's colour, as in youtube-music-cli. */
export const TAPE_MAGENTA = "oklch(0.68 0.21 330)";

export const clock = (seconds: number) => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** "Título — Artista", or what the player is doing. */
export function nowLabel(music: MusicPlayer) {
  if (music.status === "resolving") return "sintonizando…";
  if (music.status === "error") return music.error ?? "erro";
  return music.current ? `${music.current.track.title} — ${music.current.track.artist}` : "aperte Enter para tocar";
}

/** Magenta bar; pressing on it seeks there. */
export function ProgressBar({ value, onSeek, className = "mt-1.5 h-2.5" }: { value: number; onSeek: (fraction: number) => void; className?: string }) {
  const share = Math.min(1, Math.max(0, value));
  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek((event.clientX - box.left) / box.width);
  };
  return (
    <div
      role="slider"
      aria-label="Posição na música"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      onPointerDown={seek}
      className={`cursor-pointer bg-hud-text/10 ${className}`}
    >
      <div data-testid="music-progress" className="h-full" style={{ width: `${share * 100}%`, background: TAPE_MAGENTA }} />
    </div>
  );
}

/** Space, n, b and the volume keys, for the widgets (the player has more). */
export function musicKeys(music: MusicPlayer): Record<string, () => void> {
  return {
    " ": music.toggle,
    n: music.next,
    b: music.prev,
    "-": () => music.setVolume(music.volume - 0.05),
    "+": () => music.setVolume(music.volume + 0.05),
    "=": () => music.setVolume(music.volume + 0.05),
  };
}
