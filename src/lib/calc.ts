/** Expression calculator: tokens → shunting-yard → RPN. No `eval`. */

type Operator = "+" | "-" | "*" | "/" | "^" | "neg";

type Token = { type: "number"; value: number } | { type: "operator"; value: Operator } | { type: "open" } | { type: "close" };

/** Display characters mapped to the operators. */
const ALIASES: Record<string, Operator | "%" | "(" | ")"> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "*": "*",
  "×": "*",
  "/": "/",
  "÷": "/",
  "^": "^",
  "%": "%",
  "(": "(",
  ")": ")",
};

const PRECEDENCE: Record<Operator, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3, neg: 4 };
const RIGHT_ASSOCIATIVE: Operator[] = ["^", "neg"];

export class CalcError extends Error {}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const char = expression[i];
    if (char === " ") {
      i++;
      continue;
    }
    if (/[0-9.,]/.test(char)) {
      let j = i;
      while (j < expression.length && /[0-9.,]/.test(expression[j])) j++;
      const text = expression.slice(i, j).replace(",", ".");
      const value = Number(text);
      if (!Number.isFinite(value) || (text.match(/\./g)?.length ?? 0) > 1) throw new CalcError("número inválido");
      tokens.push({ type: "number", value });
      i = j;
      continue;
    }
    const alias = ALIASES[char];
    if (!alias) throw new CalcError(`símbolo desconhecido: ${char}`);
    const previous = tokens[tokens.length - 1];
    const afterValue = previous && (previous.type === "number" || previous.type === "close");
    if (alias === "%") {
      // Postfix percent: 50% → 0.5, applied to the number just before it.
      if (!previous || previous.type !== "number") throw new CalcError("% sem número");
      previous.value /= 100;
    } else if (alias === "(") {
      tokens.push({ type: "open" });
    } else if (alias === ")") {
      tokens.push({ type: "close" });
    } else if (alias === "-" && !afterValue) {
      tokens.push({ type: "operator", value: "neg" });
    } else if (alias === "+" && !afterValue) {
      // Unary plus: nothing to do.
    } else {
      tokens.push({ type: "operator", value: alias });
    }
    i++;
  }
  return tokens;
}

function toPostfix(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];
  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
    } else if (token.type === "operator") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type !== "operator") break;
        const higher = PRECEDENCE[top.value] > PRECEDENCE[token.value];
        const equal = PRECEDENCE[top.value] === PRECEDENCE[token.value] && !RIGHT_ASSOCIATIVE.includes(token.value);
        if (!higher && !equal) break;
        output.push(stack.pop()!);
      }
      stack.push(token);
    } else if (token.type === "open") {
      stack.push(token);
    } else {
      let found = false;
      while (stack.length) {
        const top = stack.pop()!;
        if (top.type === "open") {
          found = true;
          break;
        }
        output.push(top);
      }
      if (!found) throw new CalcError("parêntese fechado sem abrir");
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.type === "open") throw new CalcError("parêntese sem fechar");
    output.push(top);
  }
  return output;
}

/** Evaluates an arithmetic expression; throws `CalcError` on malformed input or a non-finite result. */
export function evaluate(expression: string): number {
  const postfix = toPostfix(tokenize(expression));
  if (!postfix.length) throw new CalcError("expressão vazia");
  const stack: number[] = [];
  for (const token of postfix) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }
    if (token.type !== "operator") throw new CalcError("expressão inválida");
    if (token.value === "neg") {
      if (!stack.length) throw new CalcError("expressão inválida");
      stack.push(-stack.pop()!);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new CalcError("expressão inválida");
    stack.push(token.value === "+" ? a + b : token.value === "-" ? a - b : token.value === "*" ? a * b : token.value === "/" ? a / b : a ** b);
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new CalcError("resultado inválido");
  return stack[0];
}

/** pt-BR formatting with floating-point noise removed (0.1 + 0.2 → 0,3). */
export function formatResult(value: number) {
  const clean = Number(value.toPrecision(12));
  return clean.toLocaleString("pt-BR", { maximumFractionDigits: 10, useGrouping: false });
}
