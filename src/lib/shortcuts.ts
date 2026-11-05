import type { SystemStats } from "../hooks/useSystemStats";
import { normalize } from "./search";

/** A JARVIS voice shortcut. Mirrors `SHORTCUT_TARGETS` in src-tauri/src/settings.rs. */
export type ShortcutAction =
  | "research"
  | "note"
  | "reminder"
  | "time"
  | "date"
  | "status"
  | "briefing"
  | "focus"
  | "memory"
  | "weather"
  | "agenda"
  | "agendaRemove"
  | "tasks"
  | "taskAdd"
  | "taskDone"
  | "taskRemove"
  | "cleanup"
  | "homecoming";

/** `voice:shortcut`: a shortcut and the words said after its phrase, or ("ask") a question for JARVIS. */
export interface ShortcutEvent {
  action: ShortcutAction | "ask";
  /** The words after the shortcut's phrase ("a Revolução Francesa"); a question: all of them. */
  text: string;
  /** The whole transcript. */
  said: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  "research",
  "note",
  "reminder",
  "time",
  "date",
  "status",
  "briefing",
  "focus",
  "memory",
  "weather",
  "agenda",
  "agendaRemove",
  "tasks",
  "taskAdd",
  "taskDone",
  "taskRemove",
  "cleanup",
  "homecoming",
];

export const isShortcutAction = (value: string): value is ShortcutAction => (SHORTCUT_ACTIONS as string[]).includes(value);

/** Number words as Whisper sometimes writes them ("daqui a cinco minutos"). */
const NUMBERS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90, cem: 100,
};

/** Minutes per unit. */
const UNITS: Record<string, number> = {
  minuto: 1, minutos: 1, min: 1, mins: 1, hora: 60, horas: 60, segundo: 1 / 60, segundos: 1 / 60, seg: 1 / 60,
};

/** A reminder can be up to a week away. */
export const MAX_REMINDER_MINUTES = 7 * 24 * 60;

const fold = (word: string) => normalize(word).replace(/[^a-z0-9.,]/g, "").replace(/[.,]+$/, "");

/** "20", "1,5", "vinte e cinco" at `at`: the value and the index after it. */
function readNumber(words: string[], at: number): { value: number; next: number } | null {
  const word = words[at];
  if (word === undefined) return null;
  const value = /^\d+([.,]\d+)?$/.test(word) ? Number(word.replace(",", ".")) : NUMBERS[word];
  if (value === undefined) return null;
  const unit = NUMBERS[words[at + 2]];
  // "vinte e cinco"
  if (value >= 20 && value % 10 === 0 && words[at + 1] === "e" && unit !== undefined && unit < 10) return { value: value + unit, next: at + 3 };
  return { value, next: at + 1 };
}

/** A duration starting at `at` ("20 minutos", "meia hora", "uma hora e meia", "1 hora e 30 minutos"). */
function readDuration(words: string[], at: number): { minutes: number; next: number } | null {
  let minutes = 0;
  let next = at;
  for (;;) {
    let part: { minutes: number; next: number } | null = null;
    if (words[next] === "meia" && words[next + 1]?.startsWith("hora")) part = { minutes: 30, next: next + 2 };
    else {
      const number = readNumber(words, next);
      const unit = number ? UNITS[words[number.next]] : undefined;
      if (number && unit !== undefined) {
        part = { minutes: number.value * unit, next: number.next + 1 };
        // "uma hora e meia"
        if (unit === 60 && words[part.next] === "e" && words[part.next + 1] === "meia") part = { minutes: part.minutes + 30, next: part.next + 2 };
      }
    }
    if (!part) break;
    minutes += part.minutes;
    next = part.next;
    // "1 hora e 30 minutos": another part after "e".
    if (words[next] !== "e" || !readDuration(words, next + 1)) break;
    next += 1;
  }
  return next > at ? { minutes, next } : null;
}

/** Words that tie the duration to the sentence ("em", "daqui a", "dentro de"). */
function leadingTie(words: string[], at: number) {
  if (words[at - 1] === "a" && words[at - 2] === "daqui") return at - 2;
  if (words[at - 1] === "de" && words[at - 2] === "dentro") return at - 2;
  return ["em", "daqui", "de", "por", "apos"].includes(words[at - 1]) ? at - 1 : at;
}

/**
 * "beber água em 20 minutos", "daqui a meia hora que tenho reunião", "5 minutos": how long and
 * what to say then (empty for a plain timer). Null without a duration — "às 15h" is a time of
 * day, left to JARVIS, who reads the clock.
 */
export function parseReminder(text: string): { minutes: number; text: string } | null {
  const raw = text.split(/\s+/).filter(Boolean);
  const words = raw.map(fold);
  for (let start = 0; start < words.length; start++) {
    // "às 15 horas" is a time of day.
    if (words[start - 1] === "as" || words[start - 1] === "ate") continue;
    const duration = readDuration(words, start);
    if (!duration) continue;
    if (!(duration.minutes > 0) || duration.minutes > MAX_REMINDER_MINUTES) return null;
    const rest = [...raw.slice(0, leadingTie(words, start)), ...raw.slice(duration.next)];
    // "que tenho reunião", "de ligar para a Ana": the tie words go too.
    while (rest.length && ["de", "que", "para", "pra", "pro", "sobre", "do", "da"].includes(fold(rest[0]))) rest.shift();
    const said = rest.join(" ").replace(/^[\s,:;.–-]+|[\s,:;.!?–-]+$/g, "");
    return { minutes: duration.minutes, text: said };
  }
  return null;
}

/** Words before the number of a task or an event ("a tarefa número dois", "o item 3"). */
const NUMBER_LEAD = new Set(["numero", "n", "no", "item", "id", "a", "o", "de", "do", "da"]);

/** "2", "#2", "número dois", "2 como feita" → 2; null when the words do not start with a number. */
export function leadingNumber(text: string) {
  const words = text.split(/\s+/).map(fold).filter(Boolean);
  let at = 0;
  while (NUMBER_LEAD.has(words[at])) at++;
  const number = readNumber(words, at);
  return number && Number.isInteger(number.value) && number.value > 0 ? number.value : null;
}

/**
 * A day or a time of day in the words ("sexta às 10", "amanhã", "dia 12", "14:30", "à tarde"):
 * what was said is an appointment, for the agenda. "hoje" alone is the day's to-do list.
 */
export function mentionsWhen(text: string) {
  const words = ` ${normalize(text).replace(/[^a-z0-9:/]+/g, " ")} `;
  return (
    /\s(amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana que vem|proxima semana|mes que vem|fim de semana|meio dia|meia noite|de manha|de tarde|de noite|a tarde|a noite)\s/.test(words) ||
    /\s(as|das|ate as) \d/.test(words) ||
    /\s\d{1,2} ?h(oras?)?\s/.test(words) ||
    /\s\d{1,2}:\d{2}\s/.test(words) ||
    /\sdia \d{1,2}\s/.test(words) ||
    /\s\d{1,2}\/\d{1,2}(\/\d{2,4})?\s/.test(words)
  );
}

/** A task as said ("que preciso comprar pão.") → as listed ("Preciso comprar pão"). */
export function cleanTask(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && ["que", "de", "pra", "para"].includes(fold(words[0]))) words.shift();
  return capitalize(words.join(" ").replace(/^[\s,:;–-]+|[\s,:;.!?–-]+$/g, ""));
}

/** Words after "em"/"para" that say when, not where ("para amanhã", "em uma hora"). */
const WHEN_WORDS = new Set(["hoje", "amanha", "agora", "depois", "cedo", "tarde", "noite", "manha", "semana", "fim", "o", "a", "os", "as", "um", "uma"]);
const DAY_WORDS = new Set(["hoje", "amanha", "agora"]);
/** "de" is left out: it is inside names ("Rio de Janeiro"). */
const PLACE_TIES = new Set(["em", "no", "na", "para", "pra"]);

/** "amanhã em São Paulo" → "São Paulo": the place in a weather question (null: none said). */
export function placeIn(text: string) {
  const raw = text.replace(/[?!.,;]+/g, " ").split(/\s+/).filter(Boolean);
  const words = raw.map(fold);
  // The last tie followed by a word that is not about time: "para amanhã em Curitiba".
  for (let at = words.length - 2; at >= 0; at--) {
    if (!PLACE_TIES.has(words[at]) || WHEN_WORDS.has(words[at + 1])) continue;
    const place = raw.slice(at + 1).filter((_, i) => !DAY_WORDS.has(words[at + 1 + i]));
    return place.join(" ") || null;
  }
  return null;
}

/** "20 minutos", "1 hora e 30 minutos", "30 segundos". */
export function describeDuration(minutes: number) {
  if (minutes < 1) {
    const seconds = Math.round(minutes * 60);
    return `${seconds} ${seconds === 1 ? "segundo" : "segundos"}`;
  }
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hora" : "horas"}`);
  if (rest) parts.push(`${rest} ${rest === 1 ? "minuto" : "minutos"}`);
  return parts.join(" e ");
}

/** "São 14 horas e 5 minutos" (no full stop: JARVIS may go on). */
export function clockPhrase(now: Date) {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const head = hours === 1 ? "É 1 hora" : hours === 0 ? "É meia-noite" : hours === 12 ? "É meio-dia" : `São ${hours} horas`;
  if (!minutes) return `${head} em ponto`;
  return `${head} e ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

/** "São 14 horas e 5 minutos." */
export const spokenTime = (now: Date) => `${clockPhrase(now)}.`;

/** "terça-feira, 27 de outubro de 2026" */
export function longDate(now: Date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
}

export const spokenDate = (now: Date) => `Hoje é ${longDate(now)}.`;

/** "AAAA-MM-DD" and "HH:MM", local. */
export function localStamp(now: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
}

/** What JARVIS can tell about the machine (anything missing is left out). */
export interface MachineState {
  stats: SystemStats | null;
  battery: { level: number; charging: boolean } | null;
  /** What jv_T4p3 is playing. */
  music: { title: string; artist: string; station: string; playing: boolean } | null;
}

const percent = (share: number) => `${Math.round(share * 100)} por cento`;
const gigabytes = (bytes: number) => `${Math.round(bytes / 1024 ** 3)} gigabytes`;
const usage = (value: { used: number; total: number }) => (value.total > 0 ? value.used / value.total : 0);

/** What needs attention ("o disco C está quase cheio") and the readings, as spoken phrases. */
export function machineReadings({ stats, battery }: MachineState) {
  const warnings: string[] = [];
  const readings: string[] = [];
  if (stats?.cpu != null) {
    readings.push(`processador em ${percent(stats.cpu)}`);
    if (stats.cpu > 0.85) warnings.push("o processador está sob carga pesada");
  }
  if (stats?.ram) {
    readings.push(`memória em ${percent(usage(stats.ram))}`);
    if (usage(stats.ram) > 0.9) warnings.push("a memória está quase cheia");
  }
  const system = stats?.disks.find((disk) => disk.name.toUpperCase().startsWith("C")) ?? stats?.disks[0];
  if (system) {
    const free = system.total - system.used;
    readings.push(`${gigabytes(free)} livres no disco ${system.name.replace(":", "")}`);
    if (free / system.total < 0.1) warnings.push(`o disco ${system.name.replace(":", "")} está quase cheio`);
  }
  if (battery) {
    readings.push(`bateria em ${percent(battery.level)}${battery.charging ? ", carregando" : ""}`);
    if (battery.level < 0.15 && !battery.charging) warnings.push("a bateria está baixa, convém ligar na tomada");
  }
  if (stats?.wlan) readings.push(`Wi-Fi ${stats.wlan.ssid} com sinal de ${percent(stats.wlan.signal)}`);
  return { warnings, readings };
}

export const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The machine in a few plain sentences, what needs attention first (for JARVIS's briefing). */
export function spokenStatus(state: MachineState) {
  const { warnings, readings } = machineReadings(state);
  if (!readings.length) return "Não consigo ler os sensores do sistema agora.";
  const head = warnings.length ? `Atenção: ${warnings.join(", ")}.` : "Todos os sistemas operando normalmente.";
  return `${head} ${capitalize(readings.join(", "))}.`;
}

/** The same, as data for JARVIS (the `system_status` tool). */
export function statusReport({ stats, battery, music }: MachineState, now: Date) {
  const lines = [`Hora local: ${localStamp(now).time}, ${longDate(now)}`];
  if (stats?.cpu != null) lines.push(`CPU: ${Math.round(stats.cpu * 100)}%`);
  if (stats?.gpu != null) lines.push(`GPU: ${Math.round(stats.gpu * 100)}%`);
  if (stats?.ram) lines.push(`RAM: ${Math.round(usage(stats.ram) * 100)}% de ${Math.round(stats.ram.total / 1024 ** 3)} GB`);
  for (const disk of stats?.disks ?? []) lines.push(`Disco ${disk.name}: ${Math.round((disk.total - disk.used) / 1024 ** 3)} GB livres de ${Math.round(disk.total / 1024 ** 3)} GB`);
  if (battery) lines.push(`Bateria: ${Math.round(battery.level * 100)}%${battery.charging ? " (carregando)" : ""}`);
  if (stats?.wlan) lines.push(`Wi-Fi: ${stats.wlan.ssid}, sinal ${Math.round(stats.wlan.signal * 100)}%`);
  if (music) lines.push(`Música: ${music.title} — ${music.artist} (${music.station})${music.playing ? "" : ", pausada"}`);
  return lines.join("\n");
}

/** The user's words, quoted for a prompt. */
const quote = (text: string) => `"${text.replace(/"/g, "'")}"`;

/**
 * What JARVIS (Claude Code) is asked when a shortcut needs him: the user's words and what the
 * shortcut means. `said` is the whole transcript, `text` what came after the shortcut's phrase.
 */
export function shortcutPrompt(
  action: "research" | "briefing" | "memory" | "reminder" | "note",
  said: string,
  text: string,
  context: { now: Date; machine?: string; weather?: string; agenda?: string; tasks?: string },
) {
  const clock = `Agora são ${localStamp(context.now).time} de ${longDate(context.now)}.`;
  switch (action) {
    case "research":
      return [
        `[Atalho: pesquisa] O usuário disse: ${quote(said)}. Assunto: ${text}.`,
        "Pesquise na web e salve o resultado como nota em Notas/AAAA-MM-DD Pesquisa - <assunto curto>.md (data de hoje): título, um resumo de três a cinco linhas, os pontos principais em tópicos, números e datas que importam e, no fim, uma seção \"Fontes\" com os links usados.",
        "Depois diga, em até duas frases, o principal achado e que a nota está salva.",
      ].join("\n");
    case "briefing":
      return [
        `[Atalho: briefing] O usuário disse: ${quote(said)}. ${clock}${context.machine ? ` Estado do computador: ${context.machine}` : ""}`,
        `Clima: ${context.weather ?? "cidade desconhecida (o widget Clima não tem cidade)"}`,
        `Agenda de hoje: ${context.agenda ?? "nada marcado"}`,
        `Tarefas pendentes: ${context.tasks ?? "nenhuma"}`,
        "Dê um briefing falado de até seis frases curtas, sem listas: cumprimente conforme a hora, o clima de hoje (dos dados acima; sem cidade, pergunte a cidade no fim e não pesquise o clima), os compromissos de hoje e quantas tarefas pendentes, se houver, e as duas ou três notícias mais importantes do dia. Use no máximo duas buscas, só para as notícias. Mencione o computador só se algo pedir atenção.",
      ].join("\n");
    case "note":
      return `[Atalho: anotação] O usuário disse: ${quote(said)}. ${clock} Se for um compromisso (tem dia ou horário: consulta, reunião, evento, prazo), marque com agenda_add; se for algo a fazer, sem horário, ponha na lista com tasks_add; senão, acrescente em Notas/AAAA-MM-DD Anotações.md, como de costume. Confirme em uma frase.`;
    case "memory":
      return `[Atalho: memória] O usuário disse: ${quote(said)}. Guarde isso em Memória.md e confirme em uma frase.`;
    case "reminder":
      return `[Atalho: lembrete] O usuário disse: ${quote(said)}. ${clock} Agende com reminder_set (calcule os minutos) e confirme em uma frase; se faltar quando, pergunte.`;
  }
}
