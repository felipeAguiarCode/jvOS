import { useEffect, useRef } from "react";
import { LESSONS } from "../../../../lib/lab/lessons";
import { doneCount, type LabProgress } from "../../../../lib/lab/progress";
import type { Lesson } from "../../../../lib/lab/types";

/** `[████░░░░]` in spans, so it can sit inside a button. */
function TextBar({ share, cells }: { share: number; cells: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, share)) * cells);
  return (
    <span aria-hidden className="whitespace-pre text-hud-light">
      [{"█".repeat(filled)}
      <span className="text-hud-text/25">{"░".repeat(cells - filled)}</span>]
    </span>
  );
}

function LessonCard({ lesson, index, progress, focused, onOpen }: { lesson: Lesson; index: number; progress: LabProgress; focused: boolean; onOpen: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const count = doneCount(lesson, progress);
  const total = lesson.steps.length;
  useEffect(() => {
    if (focused) button.current?.focus();
  }, [focused]);
  return (
    <button
      ref={button}
      type="button"
      aria-label={lesson.title}
      aria-describedby={`lab-about-${lesson.id}`}
      data-lesson={lesson.id}
      onClick={onOpen}
      className="flex h-full w-full cursor-pointer flex-col gap-2 rounded-md border border-hud-cyan/30 px-3 py-2.5 text-left outline-none transition-colors hover:border-hud-light/70 hover:bg-hud-cyan/[0.06] focus-visible:border-hud-light focus-visible:bg-hud-cyan/[0.08]"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-hud-cyan">{String(index + 1).padStart(2, "0")}</span>
        <span className="font-semibold text-hud-light">{lesson.title}</span>
        <span className="ml-auto shrink-0 text-[11px] text-hud-text/45">~{lesson.minutes} min</span>
      </span>
      <span id={`lab-about-${lesson.id}`} className="font-hud text-[13px] leading-snug text-hud-text/75">
        {lesson.summary}
        <span className="sr-only">. {count === total ? "Concluída" : `${count} de ${total} desafios feitos`}.</span>
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 text-[11px] text-hud-text/60">
        <TextBar share={count / total} cells={16} />
        <span data-testid="lesson-progress">{count === total ? <span className="text-hud-light">✔ concluída</span> : `${count}/${total} desafios`}</span>
      </span>
    </button>
  );
}

/** The lessons, each with its progress; opening one starts its lab. */
export function LessonCatalog({ progress, focusId, onOpen }: { progress: LabProgress; focusId: string | null; onOpen: (id: string) => void }) {
  const total = LESSONS.reduce((sum, lesson) => sum + lesson.steps.length, 0);
  const done = LESSONS.reduce((sum, lesson) => sum + doneCount(lesson, progress), 0);
  return (
    <div className="hud-scroll @container h-full overflow-y-auto px-5 py-4">
      <header className="mb-4 max-w-[80ch]">
        <h2 className="text-[15px] font-semibold tracking-wide text-hud-light">Laboratório de IA</h2>
        <p className="mt-1 font-hud text-[13px] leading-relaxed text-hud-text/70">
          Escolha uma lição: o texto fica à esquerda e, à direita, um terminal simulado espera os comandos de cada desafio. Nada aqui chama um modelo de verdade.
        </p>
        <p className="mt-2 flex items-center gap-3 text-[11px] text-hud-text/60">
          <TextBar share={done / total} cells={30} />
          <span>
            {done}/{total} desafios
          </span>
        </p>
      </header>
      <ol aria-label="Lições" className="grid gap-3 @[640px]:grid-cols-2 @[1000px]:grid-cols-3">
        {LESSONS.map((lesson, index) => (
          <li key={lesson.id}>
            <LessonCard lesson={lesson} index={index} progress={progress} focused={lesson.id === focusId} onOpen={() => onOpen(lesson.id)} />
          </li>
        ))}
      </ol>
    </div>
  );
}
