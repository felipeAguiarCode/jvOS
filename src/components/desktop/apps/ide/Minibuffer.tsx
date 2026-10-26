import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useIde, useStore } from "./context";
import type { Prompt } from "./types";

/**
 * The line above the status bar where jv_ide asks things, like an editor's minibuffer: a name to
 * type, or lettered choices ("[s] salvar [d] descartar [c] cancelar"). Esc cancels; the keyboard
 * goes back where it was.
 */
export function Minibuffer() {
  const { prompt, promptKey } = useIde();
  return prompt ? <Question key={promptKey} prompt={prompt} /> : null;
}

function Question({ prompt }: { prompt: Prompt }) {
  const store = useStore();
  const input = useRef<HTMLInputElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState(prompt.kind === "input" ? prompt.value : "");

  // Before the next key press can arrive: the keyboard is ours from the first frame.
  useLayoutEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    if (prompt.kind === "input") {
      input.current?.focus();
      // A file name is selected up to its extension, so typing renames just that.
      const dot = prompt.value.lastIndexOf(".");
      input.current?.setSelectionRange(0, dot > 0 ? dot : prompt.value.length);
    } else choices.current?.focus();
  }, [prompt]);

  const done = (run?: () => void | Promise<void>) => {
    store.closePrompt();
    const back = previous.current;
    (back?.isConnected && back !== document.body ? back : store.container)?.focus();
    void run?.();
  };

  if (prompt.kind === "input") {
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        done(() => prompt.submit(value));
      } else if (event.key === "Escape") {
        event.preventDefault();
        done();
      }
    };
    return (
      <div role="dialog" aria-label={prompt.label} className="flex h-[20px] shrink-0 items-center gap-2 border-t border-hud-light/40 bg-hud-light/[0.06] px-2 text-[12px]">
        <label htmlFor="ide-minibuffer" className="shrink-0 text-hud-light">
          {prompt.label}
        </label>
        <input
          id="ide-minibuffer"
          ref={input}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-hud-text outline-none"
        />
        <span className="shrink-0 text-hud-text/40">Enter confirma · Esc cancela</span>
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const choice = prompt.choices.find((item) => item.key === event.key.toLowerCase());
    if (choice) {
      event.preventDefault();
      done(choice.run);
    } else if (event.key === "Escape") {
      event.preventDefault();
      done();
    }
  };

  return (
    <div
      ref={choices}
      role="alertdialog"
      aria-label={prompt.label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-[20px] shrink-0 items-center gap-2 border-t border-hud-alert/40 bg-hud-alert/[0.08] px-2 text-[12px] outline-none"
    >
      <span className="min-w-0 truncate text-hud-text">{prompt.label}</span>
      {prompt.choices.map((choice) => (
        <button key={choice.key} type="button" onClick={() => done(choice.run)} className="shrink-0 cursor-pointer outline-none hover:text-hud-light focus-visible:text-hud-light">
          <span className="text-hud-cyan">[{choice.key}]</span> {choice.label}
        </button>
      ))}
    </div>
  );
}
