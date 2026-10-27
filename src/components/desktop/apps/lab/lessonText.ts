/** The lessons' texts, `src/lib/lab/lessons/<id>.md`, bundled with the app. */
const TEXTS = import.meta.glob<string>("../../../../lib/lab/lessons/*.md", { query: "?raw", import: "default", eager: true });

export const lessonText = (id: string) => TEXTS[`../../../../lib/lab/lessons/${id}.md`] ?? "";
