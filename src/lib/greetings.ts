import { readJson, writeJson } from "./storage";

/** Who JARVIS greets after the boot. */
export const NAME = "Builder";

interface GreetingVariant {
  /** Two lines, as they are laid out inside the core. */
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
  { lines: [`Olá ${NAME},`, "o que vamos fazer hoje?"] },
  { lines: ["Bem-vindo de volta,", `${NAME}.`] },
  { lines: ["Sistemas online.", `Às suas ordens, ${NAME}.`] },
  { lines: ["Núcleo estável.", "O que vamos construir hoje?"] },
  { lines: [`Tudo calibrado, ${NAME}.`, "Qual é o plano?"] },
  { lines: ["Pronto quando você estiver,", `${NAME}.`] },
  { lines: [`Olá ${NAME},`, "em que posso ajudar?"] },
  { lines: ["Todos os sistemas verdes.", `Vamos nessa, ${NAME}?`] },
  { lines: [`Reator estável, ${NAME}.`, "Por onde começamos?"] },
  { lines: ["Diagnóstico completo.", `Nenhuma anomalia, ${NAME}.`] },
  { lines: ["Holograma sincronizado.", `Sua vez, ${NAME}.`] },
  { lines: ["Memória carregada.", "Continuamos de onde paramos?"] },
  { lines: ["De volta ao laboratório,", `${NAME}?`] },
  { lines: [`Ideias na fila, ${NAME}.`, "Qual delas primeiro?"] },
  { lines: ["Inicialização concluída.", `O palco é seu, ${NAME}.`] },
  { lines: [`Às ordens, ${NAME}.`, "O que vamos inventar hoje?"] },
  { lines: ["Conexão estabelecida.", `Pode falar, ${NAME}.`] },
  { lines: ["Café opcional,", "código obrigatório."] },
  { lines: [`Bom te ver, ${NAME}.`, "Vamos construir algo incrível."] },
  { lines: ["Protocolos ativos.", `Aguardando instruções, ${NAME}.`] },
  { lines: ["Nenhum bug à vista.", `Por enquanto, ${NAME}.`] },
  { lines: [`Painel pronto, ${NAME}.`, "Qual é a missão de hoje?"] },
  { lines: ["JARVIS online.", `Como posso ser útil, ${NAME}?`] },
  { lines: ["Energia a cem por cento.", `E a sua, ${NAME}?`] },
  { lines: [`Tudo em ordem, ${NAME}.`, "Mãos à obra?"] },
  { lines: ["Ambiente pronto.", `Só falta você, ${NAME}.`] },
  { lines: ["Rotinas carregadas.", `Vamos automatizar algo, ${NAME}?`] },
  { lines: ["Sensores calibrados.", `Estou ouvindo, ${NAME}.`] },
  { lines: [`Olá de novo, ${NAME}.`, "Que tal um projeto novo?"] },
  { lines: ["Núcleo aquecido.", `Pode mandar, ${NAME}.`] },
  { lines: ["Sem distrações agora.", `Só nós dois, ${NAME}.`] },
  { lines: [`Missão aceita, ${NAME}.`, "Só preciso saber qual."] },
  // Time of day.
  { lines: [`Bom dia, ${NAME}.`, "Café e código?"], hours: MORNING },
  { lines: [`Bom dia, ${NAME}.`, "Por onde começamos?"], hours: MORNING },
  { lines: [`Bom dia, ${NAME}.`, "Pronto para o primeiro commit?"], hours: MORNING },
  { lines: [`Bom dia, ${NAME}.`, "O dia está em branco. Vamos preenchê-lo."], hours: MORNING },
  { lines: [`Boa tarde, ${NAME}.`, "Vamos continuar de onde paramos?"], hours: AFTERNOON },
  { lines: [`Boa tarde, ${NAME}.`, "Hora de acelerar?"], hours: AFTERNOON },
  { lines: [`Boa tarde, ${NAME}.`, "O que ainda falta para hoje?"], hours: AFTERNOON },
  { lines: [`Boa noite, ${NAME}.`, "Mais uma rodada?"], hours: EVENING },
  { lines: [`Boa noite, ${NAME}.`, "Modo noturno ativado."], hours: EVENING },
  { lines: [`Boa noite, ${NAME}.`, "Vamos fechar o dia com chave de ouro?"], hours: EVENING },
  { lines: [`Ainda acordado, ${NAME}?`, "Então vamos lá."], hours: LATE },
  { lines: ["Madrugada produtiva,", `${NAME}?`], hours: LATE },
  { lines: ["Silêncio total lá fora.", `Perfeito para criar, ${NAME}.`], hours: LATE },
  // Day of the week.
  { lines: [`Segunda-feira, ${NAME}.`, "Vamos começar a semana com tudo."], days: [1] },
  { lines: [`Metade da semana, ${NAME}.`, "Seguimos firmes."], days: [3] },
  { lines: [`Sexta-feira, ${NAME}.`, "Último sprint da semana?"], days: [5] },
  { lines: [`Fim de semana, ${NAME}.`, "Projeto pessoal?"], days: WEEKEND },
  { lines: ["Sábado no laboratório,", `${NAME}?`], days: [6] },
  { lines: [`Domingo, ${NAME}.`, "Sem pressa. O que vamos criar?"], days: [0] },
];

/** Greetings tied to the moment are more likely than the general ones. */
const SPECIFIC_WEIGHT = 3;
/** Recently shown greetings that are not picked again. */
const MEMORY = 5;
const RECENT_KEY = "jarvis.greeting.recent";

const parseRecent = (raw: unknown) => (Array.isArray(raw) ? raw.filter((item): item is number => Number.isInteger(item)) : null);

const fitsNow = (variant: GreetingVariant, hour: number, day: number) =>
  (!variant.hours || (hour >= variant.hours[0] && hour < variant.hours[1])) && (!variant.days || variant.days.includes(day));

/** A greeting for this moment that none of the last few boots showed. */
export function pickGreeting(now = new Date(), random = Math.random): [string, string] {
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
  return choice.variant.lines;
}
