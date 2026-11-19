import { useCallback, useEffect, useRef, useState } from "react";
import { paginate, type ReplyVoice } from "../components/JarvisReply";
import { createSpeechPlayer, type SpeechPlayer } from "../lib/speech";

/** JARVIS's voice in the chat: one answer at a time, sentence by sentence. */
export interface ChatSpeech {
  /** A voice is chosen and can be played here. */
  available: boolean;
  /** The answer being spoken (its id), or null. */
  speakingId: number | null;
  /** Speaks an answer (Markdown), instead of whatever was being said. False: it cannot be spoken. */
  speak: (id: number, markdown: string) => boolean;
  stop: () => void;
}

/**
 * Speaks whole answers in the chat, where there is no core to show them word by word: the same
 * sentences as the core's reply (`paginate`), made ahead and played in order.
 */
export function useChatSpeech(voice: ReplyVoice | null, onVoice: (analyser: AnalyserNode | null) => void): ChatSpeech {
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const current = useRef<{ player: SpeechPlayer; stopped: boolean } | null>(null);
  const latest = useRef({ voice, onVoice });
  latest.current = { voice, onVoice };

  const stop = useCallback(() => {
    const run = current.current;
    current.current = null;
    if (run) {
      run.stopped = true;
      run.player.close();
    }
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    (id: number, markdown: string) => {
      stop();
      const { voice, onVoice } = latest.current;
      const { pages } = paginate(markdown, true);
      const player = voice && pages.length > 0 ? createSpeechPlayer(voice, onVoice) : null;
      if (!player) return false;
      const run = { player, stopped: false };
      current.current = run;
      setSpeakingId(id);
      pages.forEach((words, index) => player.prepare(index, words.join(" ")));
      void (async () => {
        for (let index = 0; index < pages.length && !run.stopped; index++) {
          const buffer = await player.ready(index);
          if (run.stopped) return;
          // A sentence that cannot be made or played is skipped.
          const playback = buffer && (await player.play(buffer));
          if (playback) await playback.ended;
        }
        if (run.stopped) return;
        player.close();
        if (current.current === run) {
          current.current = null;
          setSpeakingId(null);
        }
      })();
      return true;
    },
    [stop],
  );

  // Nothing is said after the chat is gone.
  useEffect(() => stop, [stop]);

  return { available: voice !== null, speakingId, speak, stop };
}
