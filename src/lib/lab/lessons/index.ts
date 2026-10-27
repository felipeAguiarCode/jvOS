import type { Lesson } from "../types";
import { esforco } from "./esforco";
import { genai } from "./genai";
import { harness } from "./harness";
import { ia } from "./ia";
import { llmLesson } from "./llm";

/** jv_lab's lessons, in the order of the catalog. Each one's text is `<id>.md` beside its file. */
export const LESSONS: Lesson[] = [ia, genai, llmLesson, esforco, harness];
