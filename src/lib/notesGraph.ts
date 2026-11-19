import { noteFileName, type Note } from "./notesArea";
import { normalize } from "./search";
import { useStoredState } from "./storage";

/** Grafo de notas (feature notes-graph). What it does and why: .specs/features/notes-graph/spec.md. */

/** The graph shows this many nodes at most: the latest notes and what they touch. */
export const MAX_NODES = 400;

/** A link written in a note: `[[target]]`, `[[target|text]]` or `[[target#section]]`. */
export interface NoteLink {
  /** The note it names, as written (trimmed). */
  target: string;
  /** What is shown: the text after `|`, or the target. */
  text: string;
}

const WIKI_LINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;
/** A `#` at the start or after a space, then a letter and letters, digits, "_", "-" or "/". */
const TAG = /(^|\s)#(\p{L}[\p{L}\p{N}_/-]*)/gu;
const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * The text split into what is prose and what is code (fenced blocks and inline spans), in order:
 * links and tags are only read, and only rewritten, in the prose.
 */
function segments(content: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  const push = (text: string, code: boolean) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.code === code) last.text += text;
    else out.push({ text, code });
  };
  let fenced = false;
  for (const line of content.split(/(?<=\n)/)) {
    if (FENCE.test(line)) {
      push(line, true);
      fenced = !fenced;
    } else if (fenced) {
      push(line, true);
    } else {
      // Inline code: `…` spans stay as they are.
      let rest = line;
      for (let match = /`[^`\n]*`/.exec(rest); match; match = /`[^`\n]*`/.exec(rest)) {
        push(rest.slice(0, match.index), false);
        push(match[0], true);
        rest = rest.slice(match.index + match[0].length);
      }
      push(rest, false);
    }
  }
  return out;
}

const prose = (content: string) =>
  segments(content)
    .filter((segment) => !segment.code)
    .map((segment) => segment.text)
    .join("\n");

/** The links of a note, in order, as written (the same target may come more than once). */
export function parseLinks(content: string): NoteLink[] {
  const links: NoteLink[] = [];
  for (const match of prose(content).matchAll(WIKI_LINK)) {
    const target = match[1].replace(/\s+/g, " ").trim();
    if (target) links.push({ target, text: match[2]?.trim() || target });
  }
  return links;
}

/** The tags of a note, lower case, each once, in order ("#Projeto/Órion" → "projeto/órion"). */
export function parseTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of prose(content).matchAll(TAG)) tags.add(match[2].toLowerCase());
  return [...tags];
}

const DATED = /^\d{4}-\d{2}-\d{2}\s+/;

/**
 * The note a link names: by its title, whatever the case or the accents; failing that, by the
 * title without its date ("2026-11-17 Reunião" answers to "reunião"). Of several, the latest.
 */
export function resolveLink(target: string, notes: Pick<Note, "path" | "title" | "modified">[]): string | null {
  const wanted = normalize(target).trim();
  if (!wanted) return null;
  const latest = (candidates: Pick<Note, "path" | "title" | "modified">[]) => candidates.reduce<Pick<Note, "path" | "modified"> | null>((best, note) => (!best || note.modified > best.modified ? note : best), null);
  const exact = latest(notes.filter((note) => normalize(note.title) === wanted));
  if (exact) return exact.path;
  return latest(notes.filter((note) => DATED.test(note.title) && normalize(note.title.replace(DATED, "")) === wanted))?.path ?? null;
}

export interface GraphNode {
  /** A note's path, "#tag", or "?name" for a link with no note yet. */
  id: string;
  kind: "note" | "tag" | "missing";
  label: string;
  /** How many edges touch it. */
  degree: number;
}

export interface GraphEdge {
  /** Indices into the nodes. */
  source: number;
  target: number;
  kind: "link" | "tag";
}

export interface NotesGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Notes left out by the limit. */
  hidden: number;
}

/**
 * The notes as a graph: a node per note, per tag and per link with no note yet; an edge per link
 * between two notes and per tag of a note, each once. Over the limit, the latest notes stay.
 */
export function buildGraph(notes: Note[], limit = MAX_NODES): NotesGraphData {
  const shown = [...notes].sort((a, b) => b.modified - a.modified).slice(0, limit);
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  const node = (id: string, kind: GraphNode["kind"], label: string) => {
    const known = index.get(id);
    if (known !== undefined) return known;
    if (nodes.length >= limit) return -1;
    index.set(id, nodes.length);
    nodes.push({ id, kind, label, degree: 0 });
    return nodes.length - 1;
  };
  for (const note of shown) node(note.path, "note", note.title);

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const edge = (source: number, target: number, kind: GraphEdge["kind"]) => {
    if (source < 0 || target < 0 || source === target) return;
    // A link has a direction (who mentions whom): A → B and B → A are two edges.
    const key = `${source}>${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, kind });
    nodes[source].degree++;
    nodes[target].degree++;
  };
  for (const note of shown) {
    if (note.content === null) continue;
    const from = index.get(note.path)!;
    for (const link of parseLinks(note.content)) {
      const path = resolveLink(link.target, notes);
      // A link to a note the limit left out is not drawn; one to no note at all is a ghost node.
      if (path) edge(from, index.get(path) ?? -1, "link");
      else edge(from, node(`?${normalize(link.target)}`, "missing", link.target), "link");
    }
    for (const tag of parseTags(note.content)) edge(from, node(`#${tag}`, "tag", `#${tag}`), "tag");
  }
  return { nodes, edges, hidden: notes.length - shown.length };
}

/** The notes that link to `path`, by their node, in the graph's order. */
export function backlinks(graph: NotesGraphData, path: string): GraphNode[] {
  const target = graph.nodes.findIndex((node) => node.id === path);
  if (target < 0) return [];
  return graph.edges.filter((edge) => edge.kind === "link" && edge.target === target).map((edge) => graph.nodes[edge.source]);
}

/** The index of every node next to each node. */
export function neighbours(graph: NotesGraphData): number[][] {
  const next = graph.nodes.map((): number[] => []);
  for (const { source, target } of graph.edges) {
    next[source].push(target);
    next[target].push(source);
  }
  return next;
}

/** Where a rendered link leads: a note (by the name written) or a tag. */
export const NOTE_HREF = "#note=";
export const TAG_HREF = "#tag=";

/**
 * The note's Markdown with its links and tags as Markdown links the reader can click
 * (`#note=<name>`, `#tag=<tag>`); a link with no note yet is marked `#note=?<name>`. Code is
 * left as it is.
 */
export function linkedMarkdown(content: string, notes: Pick<Note, "path" | "title" | "modified">[]) {
  return segments(content)
    .map((segment) =>
      segment.code
        ? segment.text
        : segment.text
            .replace(WIKI_LINK, (whole, rawTarget: string, text: string | undefined) => {
              const target = rawTarget.replace(/\s+/g, " ").trim();
              if (!target) return whole;
              const label = (text?.trim() || target).replace(/[[\]]/g, "");
              return `[${label}](${NOTE_HREF}${resolveLink(target, notes) ? "" : "?"}${encodeURIComponent(target)})`;
            })
            .replace(TAG, (_, before: string, tag: string) => `${before}[#${tag}](${TAG_HREF}${encodeURIComponent(tag.toLowerCase())})`),
    )
    .join("");
}

/** What a rendered link asks for, read back from its href (null: an ordinary link). */
export function readHref(href: string | undefined): { kind: "note"; target: string; missing: boolean } | { kind: "tag"; tag: string } | null {
  if (!href) return null;
  const decode = (text: string) => {
    try {
      return decodeURIComponent(text);
    } catch {
      // Not ours after all (a stray "%"): shown as written.
      return text;
    }
  };
  if (href.startsWith(NOTE_HREF)) {
    const rest = href.slice(NOTE_HREF.length);
    return { kind: "note", target: decode(rest.replace(/^\?/, "")), missing: rest.startsWith("?") };
  }
  if (href.startsWith(TAG_HREF)) return { kind: "tag", tag: decode(href.slice(TAG_HREF.length)) };
  return null;
}

/** The file name a link's target would take as a new note (null: nothing to name it). */
export const linkFileName = (target: string) => noteFileName(target);

/** A force-directed layout in 3D, stepped until it settles. */
export interface Simulation {
  /** x, y, z of each node, in order. */
  positions: Float32Array;
  /** One step; false once the layout has settled (nothing moves any more). */
  step: () => boolean;
  /** The radius of the sphere the nodes start on, for the camera's first distance. */
  radius: number;
  /** How far from the origin the brain goes now (its longest half), for the camera. */
  extent: () => number;
  /** The size of the brain the nodes are in now: times `BRAIN`, its three halves. */
  reach: () => number;
  /**
   * A node held where it is put (dragged), or none (null): while one is held the layout keeps
   * reacting to it, and nothing else pulls it. Letting go warms the layout to settle once more.
   */
  hold: (node: number | null, x?: number, y?: number, z?: number) => void;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** How hard the centre pulls, against the nodes' own repulsion. */
const GRAVITY = 0.35;
/**
 * The pull by axis, which makes the cloud a brain: wide (x, across the two hemispheres), low (y)
 * and long (z, front to back).
 */
const SHAPE = [0.8, 1.7, 0.55];
/** How hard the plane between the hemispheres pushes away what is near it (the fissure). */
const FISSURE = 0.5;
/** The brain the nodes are kept in: its half-width (x), half-height (y) and half-length (z), for a reach of 1. */
export const BRAIN = [1.1, 0.8, 1.3];
/** The brain reaches this many times the nodes' typical distance from the centre: the far ones are brought in to it. */
const REACH = 1.3;

/**
 * Nodes pushed apart by each other, pulled together by their edges and gently to the centre
 * (Fruchterman–Reingold in three dimensions), cooling as it goes. The centre pulls unevenly and a
 * fissure splits the middle: it settles as two hemispheres, with the links between them kept. Starts on a Fibonacci sphere:
 * the same graph always settles the same way.
 */
export function createSimulation(count: number, edges: Pick<GraphEdge, "source" | "target">[]): Simulation {
  const positions = new Float32Array(count * 3);
  const radius = 14 * Math.cbrt(Math.max(count, 1)) + 10;
  for (let i = 0; i < count; i++) {
    const y = count === 1 ? 0 : 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(1 - y * y);
    const angle = i * GOLDEN_ANGLE;
    positions[i * 3] = Math.cos(angle) * ring * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(angle) * ring * radius;
  }
  /** The distance nodes like to keep. */
  const ideal = (radius * 1.6) / Math.cbrt(Math.max(count, 1));
  const moves = new Float32Array(count * 3);
  let temperature = radius * 0.12;
  const floor = radius * 0.0015;

  let held: number | null = null;
  const hold = (node: number | null, x = 0, y = 0, z = 0) => {
    held = node !== null && node >= 0 && node < count ? node : null;
    // Warm enough for the neighbours to follow, and to settle again once it is let go.
    temperature = Math.max(temperature, radius * 0.03);
    if (held !== null) positions.set([x, y, z], held * 3);
  };

  const step = () => {
    if (held !== null) temperature = Math.max(temperature, radius * 0.02);
    if (temperature <= floor || count < 2) return false;
    moves.fill(0);
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        let dx = positions[a * 3] - positions[b * 3];
        let dy = positions[a * 3 + 1] - positions[b * 3 + 1];
        let dz = positions[a * 3 + 2] - positions[b * 3 + 2];
        let distance = Math.hypot(dx, dy, dz);
        if (distance < 0.01) {
          // On top of each other: pushed apart along a fixed direction.
          dx = 0.01 * (a + 1);
          dy = 0.01;
          dz = 0;
          distance = Math.hypot(dx, dy, dz);
        }
        const push = (ideal * ideal) / distance / distance;
        moves[a * 3] += dx * push;
        moves[a * 3 + 1] += dy * push;
        moves[a * 3 + 2] += dz * push;
        moves[b * 3] -= dx * push;
        moves[b * 3 + 1] -= dy * push;
        moves[b * 3 + 2] -= dz * push;
      }
    }
    for (const { source, target } of edges) {
      const dx = positions[source * 3] - positions[target * 3];
      const dy = positions[source * 3 + 1] - positions[target * 3 + 1];
      const dz = positions[source * 3 + 2] - positions[target * 3 + 2];
      const pull = Math.hypot(dx, dy, dz) / ideal;
      moves[source * 3] -= dx * pull;
      moves[source * 3 + 1] -= dy * pull;
      moves[source * 3 + 2] -= dz * pull;
      moves[target * 3] += dx * pull;
      moves[target * 3 + 1] += dy * pull;
      moves[target * 3 + 2] += dz * pull;
    }
    const centre = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      // Gravity, growing with the distance: loose notes and separate groups stay near the rest
      // instead of drifting away from what repels them.
      const pull = (GRAVITY * Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])) / ideal;
      // Away from the plane between the hemispheres, the harder the nearer (a node on it goes to its own side).
      const across = positions[i * 3] / ideal;
      const cleft = ((across > 0 || (across === 0 && i % 2 === 0) ? 1 : -1) * FISSURE * ideal) / (1 + across * across);
      const mx = moves[i * 3] - positions[i * 3] * pull * SHAPE[0] + cleft;
      const my = moves[i * 3 + 1] - positions[i * 3 + 1] * pull * SHAPE[1];
      const mz = moves[i * 3 + 2] - positions[i * 3 + 2] * pull * SHAPE[2];
      const length = Math.hypot(mx, my, mz);
      // The one in hand stays in hand.
      const limited = i === held || length < 1e-6 ? 0 : Math.min(length, temperature) / length;
      positions[i * 3] += mx * limited;
      positions[i * 3 + 1] += my * limited;
      positions[i * 3 + 2] += mz * limited;
      for (let axis = 0; axis < 3; axis++) centre[axis] += positions[i * 3 + axis] / count;
    }
    // The whole graph stays around the origin, where the camera looks.
    // With a node in hand nothing shifts under the pointer: the centring and the brain's edge wait.
    if (held === null) {
      for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) positions[i * 3 + axis] -= centre[axis];
      contain();
    }
    temperature *= 0.97;
    return temperature > floor;
  };

  /** How far a node is, measured in brains: 1 on the surface of a brain of reach 1. */
  const depth = (i: number) => Math.hypot(positions[i * 3] / BRAIN[0], positions[i * 3 + 1] / BRAIN[1], positions[i * 3 + 2] / BRAIN[2]);
  let size = radius;
  /** The brain is as big as its nodes ask for; a node flung far from the rest (a loose tag) stays on its surface. */
  const contain = () => {
    let squares = 0;
    for (let i = 0; i < count; i++) squares += depth(i) ** 2;
    size = Math.max(ideal, REACH * Math.sqrt(squares / count));
    for (let i = 0; i < count; i++) {
      const out = depth(i);
      if (out > size) for (let axis = 0; axis < 3; axis++) positions[i * 3 + axis] *= size / out;
    }
  };

  const reach = () => size;
  const extent = () => size * Math.max(...BRAIN);

  return { positions, step, radius, extent, reach, hold };
}

/** The feature's preferences (`jarvis.notesGraph`). */
export interface NotesGraphPrefs {
  /** The graph is on screen instead of the editor. */
  open: boolean;
}

const DEFAULT_NOTES_GRAPH: NotesGraphPrefs = { open: false };

/** Tolerant: a bad field takes its default; anything but an object is null. */
export function parseNotesGraph(raw: unknown): NotesGraphPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const { open } = raw as Record<string, unknown>;
  return { open: typeof open === "boolean" ? open : DEFAULT_NOTES_GRAPH.open };
}

export function useNotesGraphPrefs() {
  const [prefs, setPrefs] = useStoredState("jarvis.notesGraph", DEFAULT_NOTES_GRAPH, parseNotesGraph);
  return [prefs, setPrefs] as const;
}
