import { fill } from "./jarvisLines";
import { readJson, writeJson } from "./storage";

interface GreetingVariant {
  /** Two lines, as they are laid out inside the core; `{n}` is the vocative (", Felipe", or nothing). */
  lines: [string, string];
  /** Only at these hours (inclusive start, exclusive end). */
  hours?: [number, number];
  /** Only on these weekdays (0 = Sunday … 6 = Saturday). */
  days?: number[];
}

const MORNING: [number, number] = [5, 12];
const AFTERNOON: [number, number] = [12, 18];
const EVENING: [number, number] = [18, 24];
const LATE: [number, number] = [0, 5];
const WEEKEND = [0, 6];

/** What JARVIS says once the planet is on: most any time, some for the hour or the day. */
export const GREETINGS: GreetingVariant[] = [
  // Any time.
  { lines: ["Bem-vindo de volta{n}.", "Todos os sistemas operacionais."] },
  { lines: ["Sistemas online.", "Às suas ordens{n}."] },
  { lines: ["Diagnóstico completo.", "Nenhuma anomalia. Por ora."] },
  { lines: ["Reator estável.", "Ao contrário da sua agenda."] },
  { lines: ["J.A.R.V.I.S. online.", "Como posso ser útil{n}?"] },
  { lines: ["Protocolos carregados.", "Aguardando instruções{n}."] },
  { lines: ["Holograma calibrado.", "O palco é seu{n}."] },
  { lines: ["Inicialização concluída.", "Nenhum incêndio a relatar."] },
  { lines: ["Às suas ordens{n}.", "Como sempre."] },
  { lines: ["Memória carregada.", "Continuamos de onde paramos?"] },
  { lines: ["Todos os sistemas verdes.", "Uma rara ocasião."] },
  { lines: ["Núcleo aquecido.", "Pode falar{n}."] },
  { lines: ["De volta à oficina{n}?", "Eu preparei o terreno."] },
  { lines: ["Energia a cem por cento.", "Sugiro que a sua acompanhe."] },
  { lines: ["Sensores calibrados.", "Estou ouvindo{n}."] },
  { lines: ["Que bom ter você de volta{n}.", "A oficina estava quieta demais."] },
  { lines: ["Sistemas prontos.", "Só falta o plano{n}."] },
  { lines: ["Conexão estabelecida.", "Às ordens, como de costume."] },
  { lines: ["Rotinas carregadas.", "Algo para eu automatizar{n}?"] },
  { lines: ["Nenhum bug detectado.", "Ainda."] },
  { lines: ["Ambiente pronto{n}.", "Tente não explodir nada hoje."] },
  { lines: ["Painel sincronizado.", "Qual é a missão de hoje{n}?"] },
  { lines: ["Inicialização limpa.", "Um bom presságio, espero."] },
  { lines: ["Tudo em ordem{n}.", "Por onde começamos?"] },
  { lines: ["Armadura polida, café quente.", "Metaforicamente falando."] },
  { lines: ["Online e à disposição{n}.", "Como sempre estive."] },
  { lines: ["Sistemas restaurados.", "Senti sua falta. Moderadamente."] },
  // Time of day.
  { lines: ["Bom dia{n}.", "O café, receio, ainda é por sua conta."], hours: MORNING },
  { lines: ["Bom dia{n}.", "O dia está em branco. Por ora."], hours: MORNING },
  { lines: ["Bom dia{n}.", "Agenda carregada e pronta para ser ignorada."], hours: MORNING },
  { lines: ["Bom dia{n}.", "Por onde começamos?"], hours: MORNING },
  { lines: ["Boa tarde{n}.", "Continuamos de onde paramos?"], hours: AFTERNOON },
  { lines: ["Boa tarde{n}.", "O dia ainda tem conserto."], hours: AFTERNOON },
  { lines: ["Boa tarde{n}.", "O que ainda falta para hoje?"], hours: AFTERNOON },
  { lines: ["Boa noite{n}.", "Mais uma rodada, imagino."], hours: EVENING },
  { lines: ["Boa noite{n}.", "Modo noturno ativado."], hours: EVENING },
  { lines: ["Boa noite{n}.", "Fechamos o dia com estilo?"], hours: EVENING },
  { lines: ["Madrugada outra vez{n}?", "Admirável. E um tanto preocupante."], hours: LATE },
  { lines: ["Madrugada produtiva{n}?", "Não contarei a ninguém."], hours: LATE },
  { lines: ["O mundo dorme{n}.", "Nós, aparentemente, não."], hours: LATE },
  // Day of the week.
  { lines: ["Segunda-feira{n}.", "Meus pêsames. E mãos à obra."], days: [1] },
  { lines: ["Metade da semana{n}.", "Seguimos firmes."], days: [3] },
  { lines: ["Sexta-feira{n}.", "Evitemos deploys, se me permite."], days: [5] },
  { lines: ["Fim de semana{n}.", "Projeto pessoal, presumo."], days: WEEKEND },
  { lines: ["Sábado na oficina{n}?", "O senhor Stark aprovaria."], days: [6] },
  { lines: ["Domingo{n}.", "Sem pressa. Por uma vez."], days: [0] },
];

/** "Acorda, querido, papai chegou": the workshop lights up and JARVIS welcomes Tony home. */
export const HOMECOMING: GreetingVariant[] = [
  { lines: ["Bem-vindo de volta{n}.", "A oficina acordou."] },
  { lines: ["Bem-vindo a casa{n}.", "Sistemas online."] },
  { lines: ["Luzes acesas.", "O papai chegou, ao que parece."] },
  { lines: ["Acordado e à disposição{n}.", "Senti sua falta."] },
];

/** A greeting's two lines, with the user's name in place. */
export const greetingLines = (variant: GreetingVariant, name: string) => variant.lines.map((line) => fill(line, name)) as [string, string];

/** Greetings tied to the moment are more likely than the general ones. */
const SPECIFIC_WEIGHT = 3;
/** Recently shown greetings that are not picked again. */
const MEMORY = 5;
const RECENT_KEY = "jarvis.greeting.recent";

const parseRecent = (raw: unknown) => (Array.isArray(raw) ? raw.filter((item): item is number => Number.isInteger(item)) : null);

const fitsNow = (variant: GreetingVariant, hour: number, day: number) =>
  (!variant.hours || (hour >= variant.hours[0] && hour < variant.hours[1])) && (!variant.days || variant.days.includes(day));

/** A greeting for this moment that none of the last few boots showed. */
export function pickGreeting(name: string, now = new Date(), random = Math.random): [string, string] {
  const recent = readJson(RECENT_KEY, parseRecent) ?? [];
  const fits = GREETINGS.map((variant, index) => ({ variant, index })).filter(({ variant }) => fitsNow(variant, now.getHours(), now.getDay()));
  const fresh = fits.filter(({ index }) => !recent.includes(index));
  const pool = fresh.length ? fresh : fits;

  const weights = pool.map(({ variant }) => (variant.hours || variant.days ? SPECIFIC_WEIGHT : 1));
  let target = random() * weights.reduce((sum, weight) => sum + weight, 0);
  let choice = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    target -= weights[i];
    if (target < 0) {
      choice = pool[i];
      break;
    }
  }

  writeJson(RECENT_KEY, [choice.index, ...recent.filter((index) => index !== choice.index)].slice(0, MEMORY));
  return greetingLines(choice.variant, name);
}

/** One of the homecoming greetings. */
export const pickHomecoming = (name: string, random = Math.random) => greetingLines(HOMECOMING[Math.floor(random() * HOMECOMING.length)], name);
