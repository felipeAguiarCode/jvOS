import { lazy, Suspense, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { ArrowLeft, Copy, RotateCcw } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePointerDrag } from "../../../../hooks/usePointerDrag";
import { LAB_PROFILE, labBackend } from "../../../../lib/lab/backend";
import { LESSONS } from "../../../../lib/lab/lessons";
import { clampSplit, doneCount, markDone, resetLesson, type LabProgress } from "../../../../lib/lab/progress";
import type { Lesson } from "../../../../lib/lab/types";
import { ToolButton, Toolbar, ToolSeparator } from "../editorChrome";
import { MARKDOWN_COMPONENTS } from "../markdownComponents";
import { lessonText } from "./lessonText";

// xterm loads with the first lesson opened, not with the catalog.
const TerminalView = lazy(() => import("../terminal/TerminalView").then((module) => ({ default: module.TerminalView })));

/** ← → on the divider move it by this share of the width. */
const KEY_STEP = 0.05;

interface LessonLabProps {
  lesson: Lesson;
  progress: LabProgress;
  setProgress: Dispatch<SetStateAction<LabProgress>>;
  onBack: () => void;
}

/** One lesson: its text and challenges on the left, the simulated terminal on the right. */
export function LessonLab({ lesson, progress, setProgress, onBack }: LessonLabProps) {
  const done = progress.done[lesson.id] ?? [];
  // Bumped by "Reiniciar lição": a new backend, so a fresh terminal.
  const [generation, setGeneration] = useState(0);
  const latest = useRef({ done, setProgress });
  latest.current = { done, setProgress };
  const backend = useMemo(
    () =>
      labBackend(lesson, {
        done: () => latest.current.done,
        onStep: (stepId) => latest.current.setProgress((current) => markDone(current, lesson.id, stepId)),
      }),
    // `generation` only asks for a new terminal.
    [lesson, generation],
  );

  const area = useRef<HTMLDivElement>(null);
  const drag = usePointerDrag<{ split: number; width: number }>({
    onStart: () => ({ split: progress.split, width: area.current?.clientWidth ?? 1 }),
    onMove: ({ dx }, start) => setProgress((current) => ({ ...current, split: clampSplit(start.split + dx / start.width) })),
    onEnd: () => undefined,
  });
  const onSplitterKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setProgress((current) => ({ ...current, split: clampSplit(current.split + (event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP)) }));
  };

  const reset = () => {
    setProgress((current) => resetLesson(current, lesson.id));
    setGeneration((value) => value + 1);
  };

  const count = doneCount(lesson, progress);
  const number = String(LESSONS.indexOf(lesson) + 1).padStart(2, "0");

  return (
    <>
      <Toolbar>
        <ToolButton label="Voltar às lições" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.6} />
        </ToolButton>
        <ToolSeparator />
        <h2 className="truncate px-1 font-semibold text-hud-light">
          <span className="text-hud-cyan">{number}</span> · {lesson.title}
        </h2>
        <span className="flex-1" />
        <span data-testid="lab-progress" className="mr-2 shrink-0 text-[11px] text-hud-text/60">
          {count}/{lesson.steps.length} desafios
        </span>
        <ToolButton label="Reiniciar lição" onClick={reset}>
          <RotateCcw size={14} strokeWidth={1.6} />
        </ToolButton>
      </Toolbar>

      <div ref={area} className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-col" style={{ width: `${progress.split * 100}%` }}>
          <article aria-label="Conteúdo da lição" className="hud-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3 font-hud text-sm select-text">
            <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {lessonText(lesson.id)}
            </Markdown>
          </article>
          <Challenges lesson={lesson} done={done} />
        </div>

        <div
          {...drag}
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar conteúdo e terminal"
          aria-valuenow={Math.round(progress.split * 100)}
          aria-valuemin={30}
          aria-valuemax={70}
          tabIndex={0}
          onKeyDown={onSplitterKey}
          className="w-1 shrink-0 cursor-col-resize touch-none bg-hud-cyan/15 outline-none hover:bg-hud-light/30 focus-visible:bg-hud-light/40"
        />

        <section aria-label="Terminal simulado" className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-6 shrink-0 items-center justify-between gap-2 bg-hud-text/[0.04] px-3 text-[10px] tracking-[0.12em] text-hud-text/50 uppercase">
            <span>terminal simulado</span>
            <span className="normal-case tracking-normal">help · hint · ↑↓ histórico · Tab completa</span>
          </div>
          <div className="relative min-h-0 flex-1">
            <Suspense fallback={<div className="p-3 text-hud-text/50">Carregando…</div>}>
              <TerminalView backend={backend} profile={LAB_PROFILE} label="Terminal do lab" role="region" active onExit={() => undefined} />
            </Suspense>
          </div>
        </section>
      </div>
    </>
  );
}

/** The lesson's challenges: done, current (with its hint on demand) and to come. */
function Challenges({ lesson, done }: { lesson: Lesson; done: string[] }) {
  const [hintFor, setHintFor] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const current = lesson.steps.find((step) => !done.includes(step.id));
  const count = lesson.steps.filter((step) => done.includes(step.id)).length;

  const copy = (hint: string) => {
    void navigator.clipboard?.writeText(hint).then(
      () => setCopied(hint),
      () => {},
    );
  };

  return (
    <section aria-label="Desafios" className="hud-scroll max-h-[45%] shrink-0 overflow-y-auto border-t border-hud-cyan/20 px-4 py-2">
      <h3 className="mb-1.5 flex items-center justify-between font-semibold text-hud-cyan">
        <span>Desafios</span>
        <span className="text-[11px] font-normal text-hud-text/50">
          {count}/{lesson.steps.length}
        </span>
      </h3>
      <ol className="space-y-1.5">
        {lesson.steps.map((step, index) => {
          const isDone = done.includes(step.id);
          const isCurrent = step === current;
          return (
            <li key={step.id} data-done={isDone || undefined} aria-current={isCurrent ? "step" : undefined} className="flex gap-2 leading-snug">
              <span aria-hidden className={`w-3 shrink-0 ${isDone ? "text-hud-light" : isCurrent ? "text-hud-cyan" : "text-hud-text/35"}`}>
                {isDone ? "✔" : isCurrent ? "▶" : "○"}
              </span>
              <div className="min-w-0 flex-1">
                <p className={isDone ? "text-hud-text/45" : isCurrent ? "text-hud-light" : "text-hud-text/55"}>
                  <span className="sr-only">{isDone ? "Feito: " : isCurrent ? "Atual: " : "Pendente: "}</span>
                  {index + 1}. {step.goal}
                </p>
                {isCurrent &&
                  (hintFor === step.id ? (
                    <p className="mt-1 flex items-center gap-2">
                      <code className="min-w-0 rounded bg-hud-cyan/10 px-1.5 py-0.5 break-all text-hud-holo select-text">{step.hint}</code>
                      <button
                        type="button"
                        onClick={() => copy(step.hint)}
                        title="Copiar (clique direito no terminal cola)"
                        className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-hud-text/55 outline-none hover:text-hud-light focus-visible:text-hud-light"
                      >
                        <Copy size={12} strokeWidth={1.6} />
                        {copied === step.hint ? "copiado" : "copiar"}
                      </button>
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setHintFor(step.id)}
                      className="mt-0.5 cursor-pointer text-[11px] text-hud-cyan/80 underline decoration-hud-cyan/30 underline-offset-2 outline-none hover:text-hud-light focus-visible:text-hud-light"
                    >
                      Mostrar dica
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ol>
      {!current && <p className="mt-2 text-hud-light">★ Lição concluída! Volte às lições para escolher a próxima.</p>}
    </section>
  );
}
