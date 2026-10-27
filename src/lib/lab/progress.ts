import type { Lesson } from "./types";

/** jv_lab's memory (`jarvis.lab`): the challenges done per lesson and the content/terminal split. */
export interface LabProgress {
  version: 1;
  done: Record<string, string[]>;
  /** The content column's share of the width. */
  split: number;
}

export const SPLIT_MIN = 0.3;
export const SPLIT_MAX = 0.7;

export const DEFAULT_LAB: LabProgress = { version: 1, done: {}, split: 0.5 };

export const clampSplit = (split: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, split));

export function parseLab(raw: unknown): LabProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const { done, split } = raw as Record<string, unknown>;
  const lessons: LabProgress["done"] = {};
  if (done && typeof done === "object" && !Array.isArray(done)) {
    for (const [id, steps] of Object.entries(done)) {
      if (Array.isArray(steps)) lessons[id] = steps.filter((step): step is string => typeof step === "string");
    }
  }
  return {
    version: 1,
    done: lessons,
    split: typeof split === "number" && Number.isFinite(split) ? clampSplit(split) : DEFAULT_LAB.split,
  };
}

export function markDone(progress: LabProgress, lessonId: string, stepId: string): LabProgress {
  const done = progress.done[lessonId] ?? [];
  return done.includes(stepId) ? progress : { ...progress, done: { ...progress.done, [lessonId]: [...done, stepId] } };
}

export function resetLesson(progress: LabProgress, lessonId: string): LabProgress {
  const { [lessonId]: _dropped, ...done } = progress.done;
  return { ...progress, done };
}

/** How many of the lesson's challenges are done (ids of removed challenges do not count). */
export const doneCount = (lesson: Lesson, progress: LabProgress) =>
  lesson.steps.filter((step) => progress.done[lesson.id]?.includes(step.id)).length;
