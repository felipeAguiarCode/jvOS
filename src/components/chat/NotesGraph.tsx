import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { frameRate, runFrames } from "../../lib/frameClock";
import { BRAIN, createSimulation, neighbours, type GraphNode, type NotesGraphData, type Simulation } from "../../lib/notesGraph";

/** A node is under the pointer within this many pixels of its centre. */
const PICK_PX = 16;
/** A press that travels less than this is a click on the node, not a turn of the graph. */
const CLICK_PX = 4;
/** The busiest nodes always show their name: these many at most, and past six no more than a third of them all. */
const NAMED = 12;
/** A graph this small names every node, as Obsidian's does. */
const NAME_ALL = 40;
/** Dots on each hemisphere of the brain drawn around the nodes, and on its cerebellum. */
const CORTEX = 800;
const CEREBELLUM = 260;
/** Radians a second, while nobody is turning it. */
const DRIFT = 0.06;
/** Camera distance per unit of the graph's radius that keeps it all in a 50° view, with a margin. */
const FIT = 2.5;
/** An edge is an axon: a curve of this many straight pieces, bowed outwards by this share of its length. */
const SEGMENTS = 8;
const BOW = 0.1;
/** Impulses travelling at once, and neurons glowing at once, at most. */
const IMPULSES = 64;
const FLARES = 48;
/** Units a second along an axon. */
const IMPULSE_SPEED = 60;
/** Seconds a neuron glows after it fires. */
const FLARE_LIFE = 0.7;
/** Seconds between two neurons firing by themselves (on average), and between the recalled ones firing. */
const AMBIENT_EVERY = 0.8;
const RECALL_EVERY = 1.5;
/** How likely an impulse that arrives makes its neuron fire on. */
const RELAY = 0.55;

const KIND_LABEL: Record<GraphNode["kind"], string> = { note: "nota", tag: "tag", missing: "nota a criar" };

declare global {
  interface Window {
    /** Development-only probe of the notes graph, for the Playwright checks. */
    __JARVIS_GRAPH__?: {
      /** Frames drawn so far. */
      frames: number;
      /** Where each node is on screen now (CSS pixels, relative to the viewport). */
      nodes: () => { id: string; x: number; y: number; front: boolean }[];
      /** Impulses travelling now, and all that were ever sent. */
      impulses: () => number;
      sent: number;
    };
  }
}

/** A theme token as a three.js colour. CSS knows notations three.js does not, so a canvas reads it. */
function tokenColor(name: string, fallback: string, within: Element) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return new Color(fallback);
  context.fillStyle = fallback;
  // Read where the graph is: the chat has a palette of its own (.chat-skin).
  context.fillStyle = getComputedStyle(within).getPropertyValue(name).trim() || fallback;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
}

/** A soft round dot, for the impulses and the glow of a neuron that fired. */
function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(canvas);
}

/**
 * The outline of a brain, for a reach of 1: two wrinkled hemispheres with the fissure between them
 * (flatter underneath) and the cerebellum under the back. Always the same dots.
 */
function brainShell(map: CanvasTexture) {
  const spots: number[] = [];
  const turn = Math.PI * (3 - Math.sqrt(5));
  for (const side of [-1, 1]) {
    for (let index = 0; index < CORTEX; index++) {
      const y = 1 - (2 * (index + 0.5)) / CORTEX;
      const ring = Math.sqrt(1 - y * y);
      const x = Math.cos(index * turn) * ring;
      const z = Math.sin(index * turn) * ring;
      // The folds of the cortex: the surface goes in and out a little.
      const fold = 1 + 0.045 * Math.sin(9 * z + 4 * y) * Math.cos(7 * x + 5 * y);
      spots.push(side * (0.53 + 0.47 * x) * fold * BRAIN[0], (y < 0 ? 0.78 * y : y) * fold * BRAIN[1], z * (1 - 0.1 * y) * fold * BRAIN[2]);
    }
  }
  for (let index = 0; index < CEREBELLUM; index++) {
    const y = 1 - (2 * (index + 0.5)) / CEREBELLUM;
    const ring = Math.sqrt(1 - y * y);
    spots.push(Math.cos(index * turn) * ring * 0.62 * BRAIN[0], (-0.72 + y * 0.3) * BRAIN[1], (-0.68 + Math.sin(index * turn) * ring * 0.34) * BRAIN[2]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(spots), 3));
  const shell = new Points(geometry, new PointsMaterial({ map, size: 1, sizeAttenuation: true, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false }));
  shell.frustumCulled = false;
  return shell;
}

/** Dots drawn as light: a fixed number of them, the unused ones black (additive, so unseen). */
function glowPoints(capacity: number, size: number, map: CanvasTexture) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(capacity * 3), 3));
  const points = new Points(geometry, new PointsMaterial({ map, size, sizeAttenuation: true, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  points.frustumCulled = false;
  return points;
}

type Tone = "line" | "tag" | "recalled";

/** What is built for one graph: its layout and what draws it. */
interface Built {
  simulation: Simulation;
  settled: boolean;
  nodes: InstancedMesh;
  halos: InstancedMesh;
  lines: LineSegments;
  sizes: Float32Array;
  next: number[][];
  /** The edges of each node: which, and whether the node is its source. */
  around: { edge: number; forward: boolean }[][];
  /** The middle point each edge bows through. */
  bends: Float32Array;
  /** Each node's own colour (r, g, b), as last painted: its glow when it fires. */
  tints: Float32Array;
  /** Screen x, y and depth (−1..1; over 1 is behind the camera) of each node, as last drawn. */
  screen: Float32Array;
  impulses: Points;
  flares: Points;
  /** The impulses on their way: the edge, the direction, how far (under 0: a free place) and the relays left. */
  signal: { edge: Int32Array; forward: Uint8Array; at: Float32Array; hops: Int8Array; tone: Tone[] };
  /** The neurons glowing: which, how long still (0 or less: a free place) and how bright. */
  glow: { node: Int32Array; left: Float32Array; strength: Float32Array };
}

interface NotesGraphProps {
  graph: NotesGraphData;
  /** The note open in the editor, lit apart. */
  selected: string | null;
  /** The notes JARVIS read for its latest answer (node ids): they fire, and what they reach lights up. */
  recalled: string[];
  /** The app window is hidden: nothing is drawn. */
  paused: boolean;
  /** False while another app has the focus: half the frame rate. */
  focused: boolean;
  onNode: (node: GraphNode) => void;
}

/**
 * The notes as a brain: a 3D graph (three.js) where notes, tags and links not written yet are
 * neurons and each link an axon, laid out by a force simulation in the shape of two hemispheres.
 * Neurons fire by themselves and their impulses run along the axons, now and then firing the next
 * one; the notes JARVIS read for its latest answer fire the most. Drag turns it, the wheel zooms,
 * a node under the pointer lights up with its neighbours (and everything holds still) and a click
 * opens it. Its WebGL context lives only while it is on screen (ADR-0027) and it draws on the
 * core's frame clock. Every node is also a button, in a list the keyboard and screen readers open.
 */
export function NotesGraph({ graph, selected, recalled, paused, focused, onNode }: NotesGraphProps) {
  const host = useRef<HTMLDivElement>(null);
  const names = useRef<HTMLDivElement>(null);
  /** The box's size, kept by the resize observer: reading it every frame would force a style pass. */
  const size = useRef({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  /** The list of every node, for the keyboard: built only once asked for (it is a button a node). */
  const [listed, setListed] = useState(false);
  /** The renderer is up: the graph can be built into it. */
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const fps = frameRate(paused, focused);

  const stage = useRef<{ renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; root: Group; glow: CanvasTexture; shell: Points } | null>(null);
  const built = useRef<Built | null>(null);
  const tones = useRef<Record<Tone, Color> | null>(null);
  /** `zoomed`: the user chose the distance (the wheel); until then the camera keeps the whole graph in sight. */
  const view = useRef({ yaw: 0.5, pitch: 0.2, distance: 0, zoomed: false, dragging: false, dirty: true });

  const selectedIndex = useMemo(() => graph.nodes.findIndex((node) => node.id === selected), [graph, selected]);
  const recalledIndexes = useMemo(() => {
    const wanted = new Set(recalled);
    return graph.nodes.flatMap((node, index) => (wanted.has(node.id) ? [index] : []));
  }, [graph, recalled]);
  const latest = useRef({ graph, onNode, hovered, reduced, recalledIndexes });
  latest.current = { graph, onNode, hovered, reduced, recalledIndexes };

  /** The nodes that show their name: the busiest, the open note, the recalled, the one under the pointer and its neighbours. */
  const named = useMemo(() => {
    const busiest = graph.nodes
      .map((node, index) => ({ index, degree: node.degree }))
      .filter((item) => item.degree > 0)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, Math.min(NAMED, Math.max(6, Math.ceil(graph.nodes.length / 3))))
      .map((item) => item.index);
    if (graph.nodes.length <= NAME_ALL) return graph.nodes.map((_, index) => index);
    const near = hovered === null ? [] : [hovered, ...(built.current?.next[hovered] ?? []).slice(0, 10)];
    return [...new Set([...busiest, ...(selectedIndex >= 0 ? [selectedIndex] : []), ...recalledIndexes.slice(0, NAMED), ...near])].filter((index) => index < graph.nodes.length);
  }, [graph, hovered, selectedIndex, recalledIndexes]);

  // The renderer and its canvas: created when the graph shows up, gone with it (ADR-0027).
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "default" });
    } catch {
      // No WebGL here: the list of nodes still works.
      return setFailed(true);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.dataset.testid = "notes-graph-canvas";
    canvas.className = "absolute inset-0 size-full";
    element.prepend(canvas);
    const scene = new Scene();
    const root = new Group();
    scene.add(root);
    const camera = new PerspectiveCamera(50, 1, 0.1, 10_000);
    const glow = glowTexture();
    const shell = brainShell(glow);
    root.add(shell);
    stage.current = { renderer, scene, camera, root, glow, shell };
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (!width || !height) return;
      size.current = { width, height };
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      view.current.dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const onLost = () => setFailed(true);
    canvas.addEventListener("webglcontextlost", onLost);
    setReady(true);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      stage.current = null;
      setReady(false);
      shell.geometry.dispose();
      (shell.material as PointsMaterial).dispose();
      glow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, []);

  // The graph itself: rebuilt when the notes change, the camera kept where it was.
  useEffect(() => {
    const current = stage.current;
    if (!ready || !current) return;
    const count = graph.nodes.length;
    const simulation = createSimulation(count, graph.edges);
    // Nothing moving: it shows up settled.
    if (latest.current.reduced) while (simulation.step());
    const sphere = new IcosahedronGeometry(1, 2);
    const nodes = new InstancedMesh(sphere, new MeshBasicMaterial({ color: 0xffffff }), Math.max(count, 1));
    const halos = new InstancedMesh(sphere, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, blending: AdditiveBlending, depthWrite: false }), Math.max(count, 1));
    nodes.count = halos.count = count;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(graph.edges.length * SEGMENTS * 6), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(graph.edges.length * SEGMENTS * 6), 3));
    const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = nodes.frustumCulled = halos.frustumCulled = false;
    const impulses = glowPoints(IMPULSES, 5, current.glow);
    const flares = glowPoints(FLARES, 18, current.glow);
    const sizes = Float32Array.from(graph.nodes, (node) => (node.kind === "note" ? 1 : node.kind === "tag" ? 0.8 : 0.7) + Math.sqrt(node.degree) * 0.42);
    const around: Built["around"] = graph.nodes.map(() => []);
    graph.edges.forEach((edge, index) => {
      around[edge.source].push({ edge: index, forward: true });
      around[edge.target].push({ edge: index, forward: false });
    });
    current.root.add(lines, halos, nodes, flares, impulses);
    built.current = {
      simulation,
      settled: false,
      nodes,
      halos,
      lines,
      sizes,
      next: neighbours(graph),
      around,
      bends: new Float32Array(graph.edges.length * 3),
      tints: new Float32Array(count * 3),
      screen: new Float32Array(count * 3),
      impulses,
      flares,
      signal: { edge: new Int32Array(IMPULSES), forward: new Uint8Array(IMPULSES), at: new Float32Array(IMPULSES).fill(-1), hops: new Int8Array(IMPULSES), tone: Array<Tone>(IMPULSES).fill("line") },
      glow: { node: new Int32Array(FLARES), left: new Float32Array(FLARES), strength: new Float32Array(FLARES) },
    };
    if (!view.current.distance) view.current.distance = (simulation.radius + 6) * FIT;
    view.current.dirty = true;
    return () => {
      built.current = null;
      current.root.remove(lines, halos, nodes, flares, impulses);
      sphere.dispose();
      geometry.dispose();
      (nodes.material as MeshBasicMaterial).dispose();
      (halos.material as MeshBasicMaterial).dispose();
      (lines.material as LineBasicMaterial).dispose();
      for (const points of [impulses, flares]) {
        points.geometry.dispose();
        (points.material as PointsMaterial).dispose();
      }
      nodes.dispose();
      halos.dispose();
    };
  }, [graph, ready]);

  // Colours: by kind, the open note and the recalled ones apart; a node under the pointer dims all but its neighbours.
  useEffect(() => {
    const current = built.current;
    if (!ready || !current) return;
    const within = host.current ?? document.documentElement;
    const light = tokenColor("--color-hud-light", "#e0fbff", within);
    const amber = tokenColor("--color-hud-amber", "#fbbf24", within);
    const palette = {
      note: tokenColor("--color-hud-holo", "#5eead4", within),
      tag: amber,
      missing: tokenColor("--color-hud-text", "#a8dbe5", within).multiplyScalar(0.45),
      selected: light,
      recalled: light.clone().lerp(amber, 0.45),
      line: tokenColor("--color-hud-cyan", "#22d3ee", within),
    };
    // The links are quiet, as in Obsidian: half way to the grey of the text.
    const thread = palette.line.clone().lerp(tokenColor("--color-hud-text", "#a8dbe5", within), 0.55);
    tones.current = { line: palette.line, tag: palette.tag, recalled: palette.recalled };
    const shell = stage.current?.shell;
    if (shell) {
      (shell.material as PointsMaterial).color.copy(palette.line).multiplyScalar(hovered === null ? 0.5 : 0.22);
      shell.visible = graph.nodes.length > 0;
    }
    const remembered = new Set(recalledIndexes);
    const lit = hovered === null ? null : new Set([hovered, ...current.next[hovered]]);
    const shade = (index: number) => (lit === null || lit.has(index) ? 1 : 0.16);
    const colour = new Color();
    graph.nodes.forEach((node, index) => {
      colour.copy(index === selectedIndex ? palette.selected : remembered.has(index) ? palette.recalled : palette[node.kind]);
      current.tints.set([colour.r, colour.g, colour.b], index * 3);
      colour.multiplyScalar(shade(index));
      current.nodes.setColorAt(index, colour);
      current.halos.setColorAt(index, colour);
    });
    if (current.nodes.instanceColor) current.nodes.instanceColor.needsUpdate = true;
    if (current.halos.instanceColor) current.halos.instanceColor.needsUpdate = true;
    const colours = current.lines.geometry.getAttribute("color") as BufferAttribute;
    graph.edges.forEach((edge, index) => {
      const on = lit === null ? 0.5 : lit.has(edge.source) && lit.has(edge.target) && (edge.source === hovered || edge.target === hovered) ? 1 : 0.06;
      colour.copy(lit !== null && on === 1 ? (edge.kind === "tag" ? palette.tag : palette.line) : edge.kind === "tag" ? palette.tag.clone().lerp(thread, 0.5) : thread).multiplyScalar(on);
      // Brighter by the neurons, fainter in the middle of the axon.
      for (let piece = 0; piece < SEGMENTS; piece++) {
        for (let end = 0; end < 2; end++) {
          const along = (piece + end) / SEGMENTS;
          const depth = 0.7 + 0.3 * Math.abs(2 * along - 1);
          colours.setXYZ((index * SEGMENTS + piece) * 2 + end, colour.r * depth, colour.g * depth, colour.b * depth);
        }
      }
    });
    colours.needsUpdate = true;
    view.current.dirty = true;
  }, [graph, ready, hovered, selectedIndex, recalledIndexes]);

  // The frames: the layout settling, the slow turn, the neurons firing, the drawing and the names following their nodes.
  useEffect(() => {
    if (!ready || !fps) return;
    const matrix = new Matrix4();
    const still = new Quaternion();
    const scale = new Vector3();
    const point = new Vector3();
    let last = performance.now();
    let drawn = last;
    // The nodes only move while the layout settles: after that a frame is the turn and the impulses,
    // with no node or axon sent to the GPU again (at 400 notes that was most of a frame's cost).
    let moved = true;
    let far = 0;
    let skipped = false;
    /** Where each name was last put. */
    const placed = new WeakMap<Element, [number, number]>();
    let ambient = AMBIENT_EVERY;
    let recall = 0.4;
    const probe = import.meta.env.DEV ? (window.__JARVIS_GRAPH__ ??= { frames: 0, nodes: () => [], impulses: () => 0, sent: 0 }) : null;
    if (probe) {
      probe.nodes = () => {
        const current = built.current;
        const box = host.current?.getBoundingClientRect();
        if (!current || !box) return [];
        return latest.current.graph.nodes.map((node, index) => ({
          id: node.id,
          x: box.left + current.screen[index * 3],
          y: box.top + current.screen[index * 3 + 1],
          front: current.screen[index * 3 + 2] < 1,
        }));
      };
      probe.impulses = () => built.current?.signal.at.reduce((total, at) => total + (at >= 0 ? 1 : 0), 0) ?? 0;
    }

    /** Where an edge's curve is at `along` (0 at its source, 1 at its target). */
    const curve = (current: Built, edge: number, along: number, out: Vector3) => {
      const { source, target } = latest.current.graph.edges[edge];
      const positions = current.simulation.positions;
      const a = (1 - along) * (1 - along);
      const b = 2 * (1 - along) * along;
      const c = along * along;
      return out.set(
        a * positions[source * 3] + b * current.bends[edge * 3] + c * positions[target * 3],
        a * positions[source * 3 + 1] + b * current.bends[edge * 3 + 1] + c * positions[target * 3 + 1],
        a * positions[source * 3 + 2] + b * current.bends[edge * 3 + 2] + c * positions[target * 3 + 2],
      );
    };
    const flare = (current: Built, node: number, strength: number) => {
      const { glow } = current;
      let place = 0;
      for (let index = 0; index < FLARES; index++) {
        if (glow.left[index] > 0 && glow.node[index] === node) {
          place = index;
          break;
        }
        if (glow.left[index] < glow.left[place]) place = index;
      }
      glow.node[place] = node;
      glow.left[place] = FLARE_LIFE;
      glow.strength[place] = strength;
    };
    /** A neuron fires: it glows, and impulses leave by some of its axons (never back the way one came). */
    const fire = (current: Built, node: number, hops: number, tone: Tone | null, most: number, back = -1) => {
      const ways = current.around[node];
      if (ways.length === 0) return;
      const start = Math.floor(Math.random() * ways.length);
      let sent = 0;
      for (let step = 0; step < ways.length && sent < most; step++) {
        const way = ways[(start + step) % ways.length];
        if (way.edge === back) continue;
        const place = current.signal.at.findIndex((at) => at < 0);
        if (place < 0) return;
        current.signal.edge[place] = way.edge;
        current.signal.forward[place] = way.forward ? 1 : 0;
        current.signal.at[place] = 0;
        current.signal.hops[place] = hops;
        current.signal.tone[place] = tone ?? (latest.current.graph.edges[way.edge].kind === "tag" ? "tag" : "line");
        sent++;
        if (probe) probe.sent++;
      }
    };
    const animate = (current: Built, seconds: number) => {
      const { signal, glow } = current;
      const { graph: shown, recalledIndexes: remembered } = latest.current;
      const positions = current.simulation.positions;
      ambient -= seconds;
      if (ambient <= 0 && shown.edges.length > 0) {
        ambient = AMBIENT_EVERY * (0.5 + Math.random());
        const edge = shown.edges[Math.floor(Math.random() * shown.edges.length)];
        const node = Math.random() < 0.5 ? edge.source : edge.target;
        flare(current, node, 0.7);
        fire(current, node, 2, null, 3);
      }
      recall -= seconds;
      if (recall <= 0 && remembered.length > 0) {
        recall = RECALL_EVERY;
        for (const node of remembered) {
          flare(current, node, 1.4);
          fire(current, node, 3, "recalled", 5);
        }
      }
      const places = current.impulses.geometry.getAttribute("position") as BufferAttribute;
      const lights = current.impulses.geometry.getAttribute("color") as BufferAttribute;
      for (let index = 0; index < IMPULSES; index++) {
        if (signal.at[index] < 0) {
          lights.setXYZ(index, 0, 0, 0);
          continue;
        }
        const edge = shown.edges[signal.edge[index]];
        const length = Math.max(1, Math.hypot(positions[edge.source * 3] - positions[edge.target * 3], positions[edge.source * 3 + 1] - positions[edge.target * 3 + 1], positions[edge.source * 3 + 2] - positions[edge.target * 3 + 2]));
        signal.at[index] += (IMPULSE_SPEED * seconds) / length;
        if (signal.at[index] >= 1) {
          // It arrived: the neuron there glows, and now and then fires on.
          const node = signal.forward[index] ? edge.target : edge.source;
          const tone = signal.tone[index];
          const hops = signal.hops[index];
          signal.at[index] = -1;
          lights.setXYZ(index, 0, 0, 0);
          flare(current, node, tone === "recalled" ? 1.1 : 0.8);
          if (hops > 0 && Math.random() < RELAY) fire(current, node, hops - 1, tone === "recalled" ? tone : null, 2, signal.edge[index]);
          continue;
        }
        curve(current, signal.edge[index], signal.forward[index] ? signal.at[index] : 1 - signal.at[index], point);
        places.setXYZ(index, point.x, point.y, point.z);
        const tone = tones.current?.[signal.tone[index]];
        const bright = 0.75 + 0.25 * Math.sin(Math.PI * signal.at[index]);
        lights.setXYZ(index, (tone?.r ?? 1) * bright, (tone?.g ?? 1) * bright, (tone?.b ?? 1) * bright);
      }
      places.needsUpdate = lights.needsUpdate = true;
      const spots = current.flares.geometry.getAttribute("position") as BufferAttribute;
      const shines = current.flares.geometry.getAttribute("color") as BufferAttribute;
      for (let index = 0; index < FLARES; index++) {
        glow.left[index] -= seconds;
        if (glow.left[index] <= 0) {
          shines.setXYZ(index, 0, 0, 0);
          continue;
        }
        const node = glow.node[index];
        const fade = (glow.left[index] / FLARE_LIFE) ** 2 * glow.strength[index];
        spots.setXYZ(index, positions[node * 3], positions[node * 3 + 1], positions[node * 3 + 2]);
        shines.setXYZ(index, current.tints[node * 3] * fade, current.tints[node * 3 + 1] * fade, current.tints[node * 3 + 2] * fade);
      }
      spots.needsUpdate = shines.needsUpdate = true;
    };
    /** Everything goes dark at once: the graph is held still (a node under the pointer), or motion is off. */
    const quiet = (current: Built) => {
      if (!current.signal.at.some((at) => at >= 0) && !current.glow.left.some((left) => left > 0)) return false;
      current.signal.at.fill(-1);
      current.glow.left.fill(0);
      for (const points of [current.impulses, current.flares]) {
        const lights = points.geometry.getAttribute("color") as BufferAttribute;
        (lights.array as Float32Array).fill(0);
        lights.needsUpdate = true;
      }
      return true;
    };

    return runFrames(fps, (now) => {
      const current = built.current;
      const at = stage.current;
      const eye = view.current;
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!current || !at) return;
      const { simulation } = current;
      const count = latest.current.graph.nodes.length;
      if (!current.settled) {
        // Two steps a frame: it settles in a couple of seconds.
        current.settled = !(simulation.step() && simulation.step());
        eye.dirty = true;
        moved = true;
      }
      // Far enough to see every node, whichever way it is turned (and a little more, for the names).
      if (moved) far = simulation.extent();
      const fit = (far * 1.12 + 6) * FIT;
      if (!eye.zoomed && Math.abs(fit - eye.distance) > 0.5) {
        eye.distance += (fit - eye.distance) * (latest.current.reduced ? 1 : 0.12);
        eye.dirty = true;
      }
      // Alive: the neurons fire. Under the pointer (someone is reading it) and with motion off, it is still.
      const alive = !latest.current.reduced && latest.current.hovered === null;
      const drifting = alive && !eye.dragging;
      if (drifting) eye.yaw += delta * DRIFT;
      if (!alive && quiet(current)) eye.dirty = true;
      if (!eye.dirty && !alive) return;
      // The slow turn and the impulses alone are drawn every other frame: half the cost, and it looks the same.
      if (!eye.dirty && !moved && !skipped) {
        skipped = true;
        return;
      }
      skipped = false;
      eye.dirty = false;
      const positions = simulation.positions;
      if (moved) {
        moved = false;
        // The brain around them, as big as they need it (a little more, so no neuron sits on the outline).
        at.shell.scale.setScalar(simulation.reach() * 1.12);
        // A dot keeps its share of the brain, whatever the size of it.
        (at.shell.material as PointsMaterial).size = simulation.reach() * 0.05;
        for (let index = 0; index < count; index++) {
          point.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
          current.nodes.setMatrixAt(index, matrix.compose(point, still, scale.setScalar(current.sizes[index])));
          current.halos.setMatrixAt(index, matrix.compose(point, still, scale.setScalar(current.sizes[index] * 1.9)));
        }
        current.nodes.instanceMatrix.needsUpdate = true;
        current.halos.instanceMatrix.needsUpdate = true;
        const ends = current.lines.geometry.getAttribute("position") as BufferAttribute;
        latest.current.graph.edges.forEach((edge, index) => {
          // The axon bows away from the centre, like the fibres of a brain; one through the centre is straight.
          const mx = (positions[edge.source * 3] + positions[edge.target * 3]) / 2;
          const my = (positions[edge.source * 3 + 1] + positions[edge.target * 3 + 1]) / 2;
          const mz = (positions[edge.source * 3 + 2] + positions[edge.target * 3 + 2]) / 2;
          const out = Math.hypot(mx, my, mz);
          const length = Math.hypot(positions[edge.source * 3] - positions[edge.target * 3], positions[edge.source * 3 + 1] - positions[edge.target * 3 + 1], positions[edge.source * 3 + 2] - positions[edge.target * 3 + 2]);
          const push = out > 1e-3 ? (length * BOW) / out : 0;
          current.bends.set([mx + mx * push, my + my * push, mz + mz * push], index * 3);
          for (let piece = 0; piece < SEGMENTS; piece++) {
            curve(current, index, piece / SEGMENTS, point);
            ends.setXYZ((index * SEGMENTS + piece) * 2, point.x, point.y, point.z);
            curve(current, index, (piece + 1) / SEGMENTS, point);
            ends.setXYZ((index * SEGMENTS + piece) * 2 + 1, point.x, point.y, point.z);
          }
        });
        ends.needsUpdate = true;
      }
      if (alive) animate(current, Math.min((now - drawn) / 1000, 0.1));
      drawn = now;
      at.root.rotation.set(eye.pitch, eye.yaw, 0);
      at.camera.position.set(0, 0, eye.distance);
      at.camera.lookAt(0, 0, 0);
      at.renderer.render(at.scene, at.camera);
      if (probe) probe.frames++;
      // Where each node is on screen: for the pointer, and for the names.
      const { width, height } = size.current;
      at.root.updateMatrixWorld();
      for (let index = 0; index < count; index++) {
        point.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]).applyMatrix4(at.root.matrixWorld).project(at.camera);
        current.screen[index * 3] = (point.x * 0.5 + 0.5) * width;
        current.screen[index * 3 + 1] = (-point.y * 0.5 + 0.5) * height;
        current.screen[index * 3 + 2] = point.z;
      }
      // How deep the nodes go on screen now, nearest to farthest: for the names' fading.
      let near = Infinity;
      let far_ = -Infinity;
      for (let index = 0; index < count; index++) {
        const depth = current.screen[index * 3 + 2];
        if (depth >= 1) continue;
        near = Math.min(near, depth);
        far_ = Math.max(far_, depth);
      }
      for (const label of names.current?.children ?? []) {
        const index = Number((label as HTMLElement).dataset.index);
        const depth = current.screen[index * 3 + 2];
        const style = (label as HTMLElement).style;
        // Under its node, centred; fainter the farther back it is.
        // A name is moved only once its node has gone most of a pixel: each move is work for the page.
        const x = current.screen[index * 3];
        const y = current.screen[index * 3 + 1] + current.sizes[index] * 3 + 5;
        const was = placed.get(label);
        if (!was || Math.abs(was[0] - x) + Math.abs(was[1] - y) > 0.8) {
          placed.set(label, [x, y]);
          style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
        }
        const visibility = depth < 1 ? "visible" : "hidden";
        if (style.visibility !== visibility) style.visibility = visibility;
        const faded = (label as HTMLElement).dataset.hovered !== undefined ? "1" : Math.min(1, Math.max(0.3, 1.25 - (depth - near) / Math.max(far_ - near, 1e-6))).toFixed(1);
        if (style.opacity !== faded) style.opacity = faded;
      }
    });
  }, [ready, fps, graph]);

  // The names are placed by the frames: a new set needs one.
  useEffect(() => {
    view.current.dirty = true;
  }, [named]);

  /** The node under a point of the graph's box (the nearest in front, within reach), or null. */
  const pick = (x: number, y: number) => {
    const current = built.current;
    if (!current) return null;
    let best: number | null = null;
    let distance = PICK_PX;
    for (let index = 0; index < latest.current.graph.nodes.length; index++) {
      if (current.screen[index * 3 + 2] >= 1) continue;
      const reach = Math.hypot(current.screen[index * 3] - x, current.screen[index * 3 + 1] - y);
      if (reach < distance) {
        distance = reach;
        best = index;
      }
    }
    return best;
  };

  /** A press: where it is, whether it travelled, and the node under it (dragged) or none (the graph turns). */
  const press = useRef<{ x: number; y: number; moved: boolean; node: number | null } | null>(null);
  const grip = useRef(new Vector3());

  // The wheel zooms (and must not scroll anything): a listener that may prevent the default.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const radius = built.current?.simulation.radius;
      if (!radius) return;
      event.preventDefault();
      const eye = view.current;
      eye.distance = Math.min(radius * 12, Math.max(radius * 0.8, eye.distance * Math.exp(event.deltaY * 0.001)));
      eye.zoomed = true;
      eye.dirty = true;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const links = graph.edges.length;
  const notes = graph.nodes.filter((node) => node.kind === "note").length;
  return (
    <div data-testid="notes-graph" className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={host}
        className={`absolute inset-0 touch-none ${hovered !== null ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const box = event.currentTarget.getBoundingClientRect();
          const node = pick(event.clientX - box.left, event.clientY - box.top);
          press.current = { x: event.clientX, y: event.clientY, moved: false, node };
          view.current.dragging = node === null;
        }}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const held = press.current;
          if (held) {
            const dx = event.clientX - held.x;
            const dy = event.clientY - held.y;
            if (!held.moved && Math.hypot(dx, dy) < CLICK_PX) return;
            held.moved = true;
            held.x = event.clientX;
            held.y = event.clientY;
            const current = built.current;
            const at = stage.current;
            if (held.node !== null && current && at) {
              // The node goes with the pointer, at the depth it was; the layout wakes up around it.
              grip.current
                .set(((event.clientX - box.left) / Math.max(box.width, 1)) * 2 - 1, -((event.clientY - box.top) / Math.max(box.height, 1)) * 2 + 1, current.screen[held.node * 3 + 2])
                .unproject(at.camera);
              at.root.worldToLocal(grip.current);
              current.simulation.hold(held.node, grip.current.x, grip.current.y, grip.current.z);
              current.settled = false;
              view.current.dirty = true;
              return;
            }
            const eye = view.current;
            eye.yaw += dx * 0.006;
            eye.pitch = Math.min(1.4, Math.max(-1.4, eye.pitch + dy * 0.006));
            eye.dirty = true;
            return;
          }
          const under = pick(event.clientX - box.left, event.clientY - box.top);
          if (under !== latest.current.hovered) setHovered(under);
        }}
        onPointerUp={(event) => {
          const held = press.current;
          press.current = null;
          view.current.dragging = false;
          if (held?.node !== null && held?.moved && built.current) {
            // Let go: the layout settles once more.
            built.current.simulation.hold(null);
            built.current.settled = false;
          }
          if (!held || held.moved) return;
          const box = event.currentTarget.getBoundingClientRect();
          const under = pick(event.clientX - box.left, event.clientY - box.top);
          if (under !== null) onNode(graph.nodes[under]);
        }}
        onPointerCancel={() => {
          if (press.current?.node !== null && press.current?.moved && built.current) {
            built.current.simulation.hold(null);
            built.current.settled = false;
          }
          press.current = null;
          view.current.dragging = false;
        }}
        onPointerLeave={() => {
          if (!press.current && latest.current.hovered !== null) setHovered(null);
        }}
      >
        <div ref={names} aria-hidden className="pointer-events-none absolute inset-0">
          {named.map((index) => (
            <span
              key={graph.nodes[index].id}
              data-index={index}
              data-hovered={index === hovered || undefined}
              className={`absolute top-0 left-0 max-w-[180px] truncate rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap will-change-transform ${
                index === hovered ? "bg-hud-panel/90 text-hud-light" : graph.nodes[index].kind === "tag" ? "text-hud-amber/80" : index === selectedIndex ? "text-hud-light" : "text-hud-text/65"
              }`}
              style={{ visibility: "hidden" }}
            >
              {graph.nodes[index].label}
            </span>
          ))}
        </div>
      </div>
      {failed && <p className="absolute inset-0 grid place-items-center text-[13px] text-hud-alert">Não foi possível desenhar o grafo</p>}
      {graph.nodes.length === 0 && <p className="absolute inset-0 grid place-items-center text-[13px] text-hud-text/45">Nenhuma nota para ligar ainda</p>}
      <div className="pointer-events-none absolute bottom-3 left-4 space-y-1 text-[11px] text-hud-text/55">
        {graph.nodes.length > 0 && links === 0 && <p>Escreva [[Nome da nota]] ou #tag para criar ligações</p>}
        {recalledIndexes.length > 0 && (
          <p data-testid="notes-graph-recalled" className="text-hud-light/80">
            {recalledIndexes.length === 1 ? "1 nota consultada" : `${recalledIndexes.length} notas consultadas`} pelo JARVIS na última resposta
          </p>
        )}
        <p data-testid="notes-graph-count">
          {notes} {notes === 1 ? "nota" : "notas"} · {links} {links === 1 ? "ligação" : "ligações"}
          {graph.hidden > 0 && ` · ${graph.hidden} mais antigas fora do grafo`}
        </p>
        <p aria-hidden className="flex gap-3">
          <Legend className="bg-hud-holo">notas</Legend>
          <Legend className="bg-hud-amber">tags</Legend>
          <Legend className="bg-hud-text/45">a criar</Legend>
          {recalledIndexes.length > 0 && <Legend className="bg-hud-light">consultadas</Legend>}
        </p>
      </div>
      {/* Every node, for the keyboard and screen readers: the same as a click on it. The list is
          built when asked for: a button a node, always there, weighed on every frame of the graph. */}
      <nav
        aria-label="Nós do grafo"
        className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:top-3 focus-within:right-3 focus-within:flex focus-within:max-h-[70%] focus-within:w-64 focus-within:flex-col focus-within:rounded-lg focus-within:border focus-within:border-hud-line/40 focus-within:bg-hud-panel focus-within:p-2"
      >
        <button
          type="button"
          aria-expanded={listed}
          onClick={() => setListed((open) => !open)}
          className="block w-full shrink-0 cursor-pointer rounded px-2 py-1 text-left text-[12px] font-medium text-hud-light outline-none hover:bg-hud-cyan/10 focus-visible:ring-1 focus-visible:ring-hud-light/50"
        >
          {listed ? "Esconder a lista de nós" : "Listar os nós do grafo"}
        </button>
        {listed && (
          <ul className="hud-scroll mt-1 min-h-0 space-y-0.5 overflow-y-auto">
            {graph.nodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onNode(node)}
                  className="block w-full cursor-pointer truncate rounded px-2 py-1 text-left text-[12px] text-hud-text/85 outline-none hover:bg-hud-cyan/10 focus-visible:ring-1 focus-visible:ring-hud-light/50"
                >
                  {node.label} · {KIND_LABEL[node.kind]} · {node.degree} {node.degree === 1 ? "ligação" : "ligações"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

function Legend({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${className}`} />
      {children}
    </span>
  );
}
