import type { AgendaEvent } from "../../src/lib/agenda";
import type { Quote, Weather } from "../../src/lib/feeds";
import type { Task } from "../../src/lib/tasks";

/** What JARVIS calls the user in the videos (Configurações › "Como ele te chama"). */
export const NAME = "Felipe";

/** The demo day: a Wednesday. */
export const DAY = "2026-11-04";
export const TOMORROW = "2026-11-05";

const GB = 1024 ** 3;

/** `system_stats` as the Rust side reports it; the fixture jitters CPU, GPU and RAM every second. */
export const SYSTEM = {
  cpu: 0.18,
  gpu: 0.34,
  ram: { used: 14.6 * GB, total: 31.8 * GB },
  memory: { used: 22 * GB, total: 45 * GB },
  disks: [
    { name: "C:", used: 461 * GB, total: 476 * GB },
    { name: "D:", used: 523 * GB, total: 931 * GB },
  ],
  wlan: { signal: 0.78, ssid: "Oficina-5G" },
  net: { down: 2.4e6, up: 3.1e5 },
};

const at = (time: string) => Math.floor(new Date(`${DAY}T${time}:00`).getTime() / 1000);

export const QUOTES: Record<string, Omit<Quote, "symbol" | "error">> = {
  PETR4: { name: "Petróleo Brasileiro S.A. - Petrobras", price: 38.42, change: 0.0213, currency: "BRL", time: at("16:15"), points: [37.6, 37.9, 37.7, 38.1, 38.0, 38.3, 38.42] },
  VALE3: { name: "Vale S.A.", price: 68.9, change: -0.0124, currency: "BRL", time: at("16:15"), points: [69.8, 69.5, 69.6, 69.1, 68.7, 68.95, 68.9] },
  ITUB4: { name: "Itaú Unibanco Holding S.A.", price: 36.15, change: 0.0061, currency: "BRL", time: at("16:15"), points: [35.9, 36.0, 35.95, 36.1, 36.2, 36.15] },
  BBAS3: { name: "Banco do Brasil S.A.", price: 27.84, change: -0.0035, currency: "BRL", time: at("16:15"), points: [27.95, 27.9, 27.8, 27.88, 27.84] },
  MXRF11: { name: "Maxi Renda FII", price: 9.62, change: 0.0021, currency: "BRL", time: at("16:15"), points: [9.58, 9.6, 9.59, 9.61, 9.62] },
};

export const WEATHER: Weather = {
  place: "Curitiba, Paraná",
  current: { temperature: 17.4, apparent: 16.1, humidity: 72, code: 2, wind: 9.6, day: true },
  days: [
    { date: "2026-11-04", code: 2, max: 24.1, min: 13.2, rain: 10 },
    { date: "2026-11-05", code: 61, max: 21.3, min: 14.6, rain: 80 },
    { date: "2026-11-06", code: 3, max: 22.8, min: 15.0, rain: 30 },
    { date: "2026-11-07", code: 95, max: 26.4, min: 16.9, rain: 90 },
    { date: "2026-11-08", code: 0, max: 27.2, min: 15.8, rain: 0 },
  ],
};

/** The day's commitments; anything whose warning time has passed at `now` is already said. */
export function agendaAt(now: string): AgendaEvent[] {
  const events: Omit<AgendaEvent, "alerted">[] = [
    { id: 1, title: "Daily do time", date: DAY, time: "09:30", notify: 10 },
    { id: 2, title: "Almoço com a Ana", date: DAY, time: "12:30", notify: 10 },
    { id: 3, title: "Revisão do jvOS", date: DAY, time: "15:00", notify: 10 },
    { id: 4, title: "Aula de inglês", date: DAY, time: "20:30", notify: 10 },
    { id: 5, title: "Dentista", date: TOMORROW, time: "10:00", notify: 30 },
  ];
  const clock = new Date(now).getTime();
  return events.map((event) => ({ ...event, alerted: new Date(`${event.date}T${event.time}:00`).getTime() - event.notify * 60_000 <= clock }));
}

export const TASKS: Task[] = [
  { id: 1, text: "Revisar o PR do jv_agent", done: null },
  { id: 2, text: "Pagar a conta de luz", done: null },
  { id: 3, text: "Comprar pão", done: null },
];

/** The evening list: two done during the day. */
export const TASKS_EVENING: Task[] = [
  { id: 1, text: "Revisar o PR do jv_agent", done: DAY },
  { id: 2, text: "Pagar a conta de luz", done: DAY },
  { id: 3, text: "Comprar pão", done: null },
  { id: 4, text: "Comprar café", done: null },
];

/** Window chrome for every video (the defaults, kept explicit). */
export const WINDOW_PREFS = { windowStyle: "tui", snap: true, snapDistance: 14, snapCenter: true, grid: false, opacity: 0.85 };

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where each window opens (a stored rect wins over the cascade): in the side columns, clear of the
 * hologram (x 710–1210) where JARVIS's words show, since windows sit above them.
 */
export const LAYOUT: Record<string, Rect> = {
  clock: { x: 32, y: 52, w: 300, h: 160 },
  weather: { x: 32, y: 232, w: 400, h: 230 },
  agenda: { x: 32, y: 482, w: 340, h: 420 },
  tasks: { x: 1568, y: 52, w: 320, h: 300 },
  system: { x: 1588, y: 372, w: 300, h: 290 },
  battery: { x: 1588, y: 682, w: 300, h: 150 },
  calculator: { x: 352, y: 52, w: 300, h: 420 },
  stocks: { x: 1468, y: 52, w: 420, h: 330 },
  pomodoro: { x: 1568, y: 52, w: 320, h: 250 },
  miniplayer: { x: 1528, y: 322, w: 360, h: 150 },
  tape: { x: 1508, y: 492, w: 380, h: 250 },
  markdown: { x: 1236, y: 44, w: 660, h: 870 },
  music: { x: 500, y: 120, w: 920, h: 700 },
  ide: { x: 120, y: 60, w: 1680, h: 860 },
  lab: { x: 120, y: 60, w: 1680, h: 860 },
  agent: { x: 1236, y: 44, w: 660, h: 870 },
  shell: { x: 1236, y: 44, w: 660, h: 870 },
};

/** A `jarvis.desktop` with `open` on screen (front-most last) and every window's place from LAYOUT. */
export const desktopWith = (open: string[] = [], rects: Record<string, Rect> = {}) => ({
  version: 1,
  rects: { ...LAYOUT, ...rects },
  order: open,
  maximized: [],
  prefs: WINDOW_PREFS,
});

export const MEETING_NOTE = `# Reunião de hoje · 04/11/2026

**Participantes:** Felipe, Ana, Marcos

## Decisões

- O **jv_agent** entra na próxima versão, com a revisão de PR como primeiro agente.
- A busca \`/\` ganha os comandos do Menu avançado.
- O núcleo 2D continua o padrão; o 3D fica para máquinas com GPU.

## Próximos passos

- [ ] Felipe: gravar os vídeos de demonstração
- [ ] Ana: revisar as falas do JARVIS
- [ ] Marcos: medir o tempo de boot no notebook

> Próxima reunião na sexta, às 10h.
`;

export const RESEARCH_NOTE = `# Fusão nuclear

A fusão junta núcleos leves, como o deutério e o trítio, num núcleo mais pesado e libera energia.
É o processo que alimenta o Sol.

## Onde estamos

- **ITER** (França): o maior tokamak do mundo, com o primeiro plasma previsto para a próxima década.
- **NIF** (EUA): em 2022, o primeiro experimento com ganho líquido de energia no alvo.
- **SPARC** (EUA): ímãs supercondutores de alta temperatura, para um reator compacto.

## Por que importa

- Combustível abundante, tirado da água do mar.
- Sem emissão de carbono e com pouco resíduo de longa duração.

## Fontes

- iter.org
- llnl.gov/news
- cfs.energy
`;

export const AGENT = `---
name: revisor-pr
description: Revisa pull requests do jvOS e aponta bugs, riscos e testes faltando.
tools: Read, Grep, Glob, Bash
model: sonnet
---

Você é um revisor de código do jvOS. Leia o diff do pull request indicado e:

1. Aponte bugs de lógica e casos de borda, com arquivo e linha.
2. Confira se cada mudança de comportamento tem teste no Playwright ou no cargo.
3. Verifique se a spec em \`.specs/\` foi atualizada junto.
4. Termine com um veredito curto: aprovar, pedir mudanças ou comentar.

Seja direto e educado. Não reescreva o código; sugira.
`;
