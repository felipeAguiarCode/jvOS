import type { PriceAlert } from "../hooks/useWatchlist";
import { startOf, type AgendaEvent } from "./agenda";
import { describeWeather, spokenPrice, type Quote, type Weather } from "./feeds";
import { capitalize, clockPhrase, longDate, machineReadings, type MachineState } from "./shortcuts";
import type { Task } from "./tasks";

/**
 * What JARVIS says by himself (no Claude Code): the time, reminders, confirmations of voice
 * commands. Each situation has a few lines in his voice, picked at random. `{n}` is the
 * vocative (", Felipe", or nothing when he does not know the name), so it only goes right
 * before punctuation; `{key}` is a value and `{Key}` the same value capitalized.
 */
export type Pool = readonly string[];

export const LINES = {
  time: ["{clock}{n}.", "Pelo meu relógio, {clockLower}.", "{clock}. O tempo voa, como de costume.", "{clock}{n}. Pontualmente."],
  /** Between midnight and five. */
  lateTime: [
    "{clock}. Um horário admirável para estar acordado{n}.",
    "{clock}{n}. Devo lembrar que dormir também é uma opção.",
    "{clock}. Para constar, o resto do hemisfério está dormindo.",
  ],
  date: ["Hoje é {date}{n}.", "{Date}, segundo o calendário.", "Hoje é {date}. Caso tenha perdido a conta."],
  statusOk: ["Todos os sistemas dentro dos parâmetros{n}.", "Tudo em ordem. Nada pegando fogo, por enquanto.", "Sistemas operando normalmente{n}."],
  statusWarning: ["Devo chamar sua atenção para um detalhe{n}: {warnings}.", "Nem tudo vai bem{n}: {warnings}.", "Receio que haja um problema: {warnings}."],
  statusUnknown: ["Receio que os sensores não estejam respondendo agora{n}.", "Os sensores do sistema estão em silêncio. Pouco característico deles."],
  reminderSet: ["Pois não. Daqui a {when} eu lembro você: {text}.", "Combinado{n}. Em {when}: {text}.", "Anotado. Daqui a {when}, {text}. Não deixarei passar."],
  timerSet: ["Timer de {when} correndo{n}.", "{When} no relógio, a partir de agora.", "Cronômetro iniciado: {when}."],
  reminderDue: ["Com licença{n}: {text}.", "Lembrete, conforme combinado: {text}.", "Perdão a interrupção{n}. {Text}."],
  timerDone: ["O seu timer terminou{n}.", "Tempo esgotado{n}.", "Timer concluído. Pontual, como sempre."],
  reminderFailed: ["Receio que não consegui agendar o lembrete{n}."],
  focus: [
    "Protocolo foco ativado. Janelas fechadas e {minutes} minutos no relógio{n}.",
    "Protocolo foco em andamento: distrações removidas, {minutes} minutos de concentração.",
    "Feito. Tudo fechado e {minutes} minutos de foco. Eu seguro as pontas.",
  ],
  noted: ["Anotado{n}.", "Registrado nas notas de hoje.", "Feito. Está nas anotações do dia."],
  desktopOnly: ["Receio que isso só funcione no app desktop{n}."],
  // Voice commands. Names keep their case ("jv_sh"), so they never open a sentence.
  launch: ["Abrindo {app}{n}.", "A caminho: {app}.", "Pois não. Abrindo {app}."],
  launchFailed: ["Receio que não consegui abrir {app}{n}.", "Receio que {app} se recusou a abrir. Os detalhes estão no dock."],
  cannotClose: ["Receio que fechar {app} pela voz ainda não esteja ao meu alcance{n}.", "Fechar programas pela voz ainda não é comigo, receio."],
  openWindow: ["Na tela: {title}.", "Abrindo {title}{n}.", "Aqui está: {title}."],
  closeWindow: ["Fechando {title}{n}.", "Tirei da tela: {title}.", "Feito. Fora da tela: {title}."],
  notOpen: ["Receio que {title} não esteja na tela{n}.", "Nada a fechar: {title} nem está na tela."],
  closeGroup: ["Fechando {what}{n}. Silêncio, enfim.", "{What} fora da tela.", "Feito. {What} a menos para distrair."],
  nothingOpen: ["Não há nada aberto para fechar{n}.", "Nada para fechar. Já está tudo impecável."],
  musicNext: ["Próxima faixa.", "Pulando{n}.", "Trocando de música. Esta não estava à altura, imagino."],
  musicPrevious: ["Voltando uma faixa.", "De volta à anterior{n}."],
  musicPause: ["Música em pausa{n}.", "Silêncio, como pediu."],
  musicResume: ["Retomando a música.", "De volta ao som{n}."],
  musicStation: ["Tocando {station}{n}.", "No ar: {station}.", "Pois não. Tocando {station}."],
  musicEmpty: ["Receio que não haja playlists com músicas{n}."],
  musicNotFound: ["Receio que não encontrei a playlist “{target}”{n}.", "Nenhuma playlist chamada “{target}”, receio."],
  pomodoroStart: ["Pomodoro iniciado: {phase}{n}.", "{Phase} em andamento. Eu cuido do relógio."],
  pomodoroPause: ["Pomodoro pausado{n}.", "Relógio parado. Ele espera por você."],
  pomodoroReset: ["Pomodoro reiniciado: {phase} do começo.", "De volta ao zero{n}: {phase}."],
  pomodoroSkip: ["Fase pulada{n}.", "Pulando para a próxima fase. Não contarei a ninguém."],
  pomodoroLonger: ["Mais cinco minutos de {phase}.", "Cinco minutos a mais de {phase}{n}."],
  pomodoroShorter: ["Menos cinco minutos de {phase}.", "Cinco minutos a menos de {phase}{n}."],
  // The weather.
  weatherNow: ["Em {place}, {temperature} graus e {condition}{n}.", "Lá fora, {temperature} graus e {condition}.", "Agora em {place}: {temperature} graus, {condition}."],
  weatherTomorrow: ["Amanhã em {place}: {condition}, entre {min} e {max} graus{n}.", "Para amanhã, {condition}, com mínima de {min} e máxima de {max}."],
  weatherRain: ["Chance de chuva de {rain} por cento. Um guarda-chuva seria prudente.", "Chuva provável, {rain} por cento. Leve o guarda-chuva, se me permite."],
  weatherMaybeRain: ["Chance de chuva de {rain} por cento.", "Alguma chance de chuva: {rain} por cento."],
  weatherNoCity: ["Receio que eu ainda não saiba a sua cidade{n}. Diga, por exemplo, “clima em Curitiba”.", "Preciso da cidade para isso. Experimente “clima em São Paulo”."],
  weatherFailed: ["Receio que a previsão do tempo não respondeu agora{n}.", "Os satélites estão calados no momento. Tente de novo em instantes."],
  // The agenda.
  agendaList: ["{When}, {count}{n}: {items}.", "Na agenda de {when}: {items}."],
  agendaEmpty: ["Nada marcado para {when}{n}. Uma raridade.", "Agenda livre {when}{n}.", "Nenhum compromisso {when}. Aproveite."],
  agendaDue: ["Com licença{n}: {title}, {when}.", "Da agenda: {title}, {when}.", "Lembrete da agenda{n}. {Title}, {when}."],
  agendaRemoved: ["Desmarcado{n}: {title}.", "Compromisso {id} cancelado: {title}.", "Fora da agenda: {title}. Um alívio, imagino."],
  agendaNotFound: ["Receio que não haja compromisso número {id}{n}.", "Nenhum compromisso com o número {id}, receio."],
  // The day's to-do list.
  taskAdded: ["Na lista{n}: {text}. Número {id}.", "Anotado como tarefa {id}: {text}.", "Feito. Tarefa {id}, {text}."],
  taskNotAdded: ["Receio que não consegui pôr na lista{n}: {problem}."],
  taskDone: ["Tarefa {id} concluída{n}. Uma a menos.", "Riscada da lista: {text}.", "Feito: {text}. Admirável."],
  taskRemoved: ["Tarefa {id} fora da lista{n}.", "Apagada: {text}.", "Removida a tarefa {id}. Ninguém precisa saber."],
  taskNotFound: ["Receio que não haja tarefa {what} na lista{n}.", "Não encontrei a tarefa {what}, receio."],
  tasksList: ["{Count} na lista{n}: {items}.", "Na sua lista, {count}: {items}."],
  tasksEmpty: ["Nenhuma tarefa pendente{n}. Suspeito, mas admirável.", "Lista limpa{n}. Nada pendente.", "Nada na lista. Aproveite enquanto dura."],
  // "Limpa a memória", "ativa o garbage collector": Claude Code, idle, gives its RAM back.
  cleanupDone: [
    "Memória liberada{n}: {freed} devolvidos ao sistema. O Claude volta na próxima pergunta.",
    "Garbage collector concluído. {Freed} a menos na RAM; o Claude acorda quando você precisar.",
    "Faxina feita{n}. {Freed} liberados, e a conversa continua de onde parou.",
  ],
  cleanupStopped: ["Claude em repouso{n}. A memória dele está de volta ao sistema.", "Garbage collector concluído. O Claude volta na próxima pergunta."],
  cleanupIdle: ["Nada a recolher{n}. O Claude já estava em repouso.", "A memória já está em ordem. O Claude nem estava acordado."],
  cleanupBusy: ["Receio que o Claude esteja no meio de uma resposta{n}. Peça a limpeza quando ele terminar.", "Agora não, receio: o Claude está trabalhando. Peça de novo em instantes."],
  // "Acorda, querido, papai chegou."
  homecoming: [
    "Bem-vindo de volta{n}. Todos os sistemas online.",
    "Bem-vindo a casa{n}. A oficina estava quieta demais sem você.",
    "Às suas ordens{n}. Luzes acesas e núcleo estável.",
    "Bem-vindo de volta. Senti sua falta{n}, na medida em que um sistema operacional sente alguma coisa.",
  ],
  // Stocks.
  stockAlert: ["Alerta de preço{n}: {symbol} a {price}, {direction} de {limit}.", "{symbol} chegou a {price}, como você pediu que eu vigiasse.", "Com licença{n}. {symbol} cruzou {limit}: está a {price}."],
} satisfies Record<string, Pool>;

export type LineKey = keyof typeof LINES;
export type LineValues = Record<string, string | number>;

/** ", Felipe" — or nothing, when JARVIS does not know the name. */
export const vocative = (name: string) => (name.trim() ? `, ${name.trim()}` : "");

/** A template with the vocative and the values in place. */
export function fill(template: string, name: string, values: LineValues = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (key === "n") return vocative(name);
    if (key in values) return String(values[key]);
    const lower = `${key.charAt(0).toLowerCase()}${key.slice(1)}`;
    return lower in values ? capitalize(String(values[lower])) : "";
  });
}

/** The last line said for each situation, so he does not repeat himself twice in a row. */
const lastPicked = new Map<LineKey, number>();

/** One of JARVIS's lines for `key`, never the one he said the last time. */
export function line(key: LineKey, name: string, values: LineValues = {}, random = Math.random) {
  const pool: Pool = LINES[key];
  const last = lastPicked.get(key);
  const choices = pool.map((_, index) => index).filter((index) => pool.length === 1 || index !== last);
  const index = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
  lastPicked.set(key, index);
  return fill(pool[index], name, values);
}

/** "São 14 horas e 5 minutos, Felipe." — with a remark in the small hours. */
export function timeLine(now: Date, name: string, random = Math.random) {
  const clock = clockPhrase(now);
  const late = now.getHours() < 5;
  return line(late ? "lateTime" : "time", name, { clock, clockLower: `${clock.charAt(0).toLowerCase()}${clock.slice(1)}` }, random);
}

export const dateLine = (now: Date, name: string, random = Math.random) => line("date", name, { date: longDate(now) }, random);

/** The machine: what needs attention first, then the readings. */
export function statusLine(state: MachineState, name: string, random = Math.random) {
  const { warnings, readings } = machineReadings(state);
  if (!readings.length) return line("statusUnknown", name, {}, random);
  const head = warnings.length ? line("statusWarning", name, { warnings: warnings.join(", ") }, random) : line("statusOk", name, {}, random);
  return `${head} ${capitalize(readings.join(", "))}.`;
}

/** The user's words for a reminder, without the full stop (the line has its own). */
export const reminderText = (text: string) => text.trim().replace(/[.!]+$/, "");

/** "15:30" → "15 e 30", "09:00" → "9 horas", "13:00" → "13 horas". */
export function spokenClock(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  if (!minutes) return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  return `${hours} e ${minutes}`;
}

/** The weather today (now, the day's range, the rain) or tomorrow. */
export function weatherLine(weather: Weather, when: "today" | "tomorrow", name: string, random = Math.random) {
  const place = weather.place.split(",")[0];
  const day = weather.days[when === "today" ? 0 : 1];
  const rainLine = (rain: number) => (rain >= 60 ? ` ${line("weatherRain", name, { rain: Math.round(rain) }, random)}` : rain >= 30 ? ` ${line("weatherMaybeRain", name, { rain: Math.round(rain) }, random)}` : "");
  if (when === "tomorrow" && day) {
    const values = { place, condition: describeWeather(day.code).text, min: Math.round(day.min), max: Math.round(day.max) };
    return `${line("weatherTomorrow", name, values, random)}${rainLine(day.rain)}`;
  }
  const { current } = weather;
  const now = line("weatherNow", name, { place, temperature: Math.round(current.temperature), condition: describeWeather(current.code, current.day).text }, random);
  return day ? `${now} Hoje, mínima de ${Math.round(day.min)} e máxima de ${Math.round(day.max)}.${rainLine(day.rain)}` : now;
}

/** "Hoje, 2 compromissos: às 15 horas, Reunião com a Ana; o dia todo, Aniversário da mãe." */
export function agendaLine(events: AgendaEvent[], when: "hoje" | "amanhã", name: string, random = Math.random) {
  if (!events.length) return line("agendaEmpty", name, { when }, random);
  const items = events.map((event) => `${event.time ? `às ${spokenClock(event.time)}` : "o dia todo"}, ${event.title}`).join("; ");
  const count = events.length === 1 ? "1 compromisso" : `${events.length} compromissos`;
  return line("agendaList", name, { when, count, items }, random);
}

/** "2 tarefas pendentes: número 1, Comprar pão; número 3, Ligar para a Ana." */
export function tasksLine(tasks: Task[], name: string, random = Math.random) {
  const pending = tasks.filter((task) => !task.done);
  if (!pending.length) return line("tasksEmpty", name, {}, random);
  const items = pending.map((task) => `número ${task.id}, ${task.text}`).join("; ");
  const count = pending.length === 1 ? "1 tarefa pendente" : `${pending.length} tarefas pendentes`;
  return line("tasksList", name, { count, items }, random);
}

/** Today: the agenda, then what is left on the list (the name said once). */
export function dayLine(events: AgendaEvent[], tasks: Task[], name: string, random = Math.random) {
  const agenda = agendaLine(events, "hoje", name, random);
  return tasks.some((task) => !task.done) ? `${agenda} ${tasksLine(tasks, "", random)}` : agenda;
}

/** An event about to start ("em 10 minutos") or starting now. */
export function agendaDueLine(event: AgendaEvent, now: number, name: string, random = Math.random) {
  const minutes = Math.round((startOf(event) - now) / 60_000);
  const when = minutes >= 1 ? `em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}` : "agora";
  return line("agendaDue", name, { title: event.title, when }, random);
}

/** A price alert that went off. */
export function stockAlertLine(alert: PriceAlert, quote: Quote, name: string, random = Math.random) {
  const up = alert.above !== null && quote.price >= alert.above;
  const limit = (up ? alert.above : alert.below) ?? quote.price;
  return line("stockAlert", name, { symbol: quote.symbol, price: spokenPrice(quote.price, quote.currency), direction: up ? "acima" : "abaixo", limit: spokenPrice(limit, quote.currency) }, random);
}
