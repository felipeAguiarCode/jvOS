import { useState, type KeyboardEvent } from "react";
import { Delete } from "lucide-react";
import { evaluate, formatResult } from "../../../lib/calc";

type Key =
  | { label: string; insert: string; name?: string; wide?: boolean }
  | { label: string; action: "clear" | "backspace" | "negate" | "equals"; name?: string; wide?: boolean };

/** Six rows of four. */
const KEYS: Key[] = [
  { label: "C", action: "clear", name: "Limpar" },
  { label: "⌫", action: "backspace", name: "Apagar" },
  { label: "(", insert: "(" },
  { label: ")", insert: ")" },
  { label: "%", insert: "%" },
  { label: "^", insert: "^" },
  { label: "±", action: "negate", name: "Inverter sinal" },
  { label: "÷", insert: "÷" },
  { label: "7", insert: "7" },
  { label: "8", insert: "8" },
  { label: "9", insert: "9" },
  { label: "×", insert: "×" },
  { label: "4", insert: "4" },
  { label: "5", insert: "5" },
  { label: "6", insert: "6" },
  { label: "−", insert: "−" },
  { label: "1", insert: "1" },
  { label: "2", insert: "2" },
  { label: "3", insert: "3" },
  { label: "+", insert: "+" },
  { label: "0", insert: "0", wide: true },
  { label: ",", insert: "," },
  { label: "=", action: "equals", name: "Igual" },
];

const OPERATORS = new Set(["+", "−", "×", "÷", "^", "%"]);
const KEYBOARD: Record<string, string> = { "*": "×", "/": "÷", "-": "−", ".": ",", ",": "," };

/**
 * Calculator drawn like a REPL ("> expression", then "= result") over a flat keypad whose
 * cells light up in reverse video; the keyboard works while it has focus.
 */
export function Calculator() {
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const insert = (text: string) => {
    if (result !== null) {
      // After "=", an operator continues from the result; anything else starts over.
      setExpression(OPERATORS.has(text) || text === ")" ? result.replace(",", ".").replace(".", ",") + text : text);
      setResult(null);
      return;
    }
    setExpression((current) => current + text);
  };

  const run = (action: Extract<Key, { action: string }>["action"]) => {
    if (action === "clear") {
      setExpression("");
      setResult(null);
    } else if (action === "backspace") {
      if (result !== null) {
        setResult(null);
        setExpression("");
      } else setExpression((current) => current.slice(0, -1));
    } else if (action === "negate") {
      const source = result ?? expression;
      setResult(null);
      // Toggle the sign of the trailing number.
      const match = /(-?)(\d[\d,.]*)$/.exec(source);
      if (!match) return setExpression(source);
      const head = source.slice(0, match.index);
      setExpression(match[1] ? head + match[2] : `${head}-${match[2]}`);
    } else if (action === "equals") {
      if (!expression.trim()) return;
      try {
        setResult(formatResult(evaluate(expression)));
      } catch {
        setResult("Erro");
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    let handled = true;
    if (/^[0-9]$/.test(key) || key === "(" || key === ")" || key === "+" || key === "^" || key === "%") insert(key);
    else if (key in KEYBOARD) insert(KEYBOARD[key]);
    else if (key === "Enter" || key === "=") run("equals");
    else if (key === "Backspace") run("backspace");
    else if (key === "Escape" || key === "Delete") run("clear");
    else handled = false;
    if (handled) event.preventDefault();
  };

  return (
    <div tabIndex={0} onKeyDown={onKeyDown} className="flex h-full flex-col gap-2 px-3 pt-2 pb-3 font-mono outline-none">
      <div className="flex min-h-16 flex-col justify-end gap-0.5 select-text">
        <div className="flex min-h-5 gap-2 text-[12px] text-hud-text/55">
          <span className="text-hud-cyan">&gt;</span>
          <span className="truncate">{result !== null ? expression : ""}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] text-hud-cyan">{result !== null ? "=" : ">"}</span>
          <span
            data-testid="calc-display"
            className={`min-w-0 flex-1 truncate text-2xl leading-tight tabular-nums ${result === "Erro" ? "text-hud-alert" : "text-hud-light"}`}
          >
            {result ?? (expression || "0")}
          </span>
          {result === null && (
            <span aria-hidden className="crt-cursor text-xl text-hud-light/80">
              ▌
            </span>
          )}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-4 gap-px">
        {KEYS.map((key) => {
          const operator = "insert" in key ? OPERATORS.has(key.insert) : key.action === "equals";
          return (
            <button
              key={key.label}
              type="button"
              aria-label={key.name ?? key.label}
              onClick={() => ("insert" in key ? insert(key.insert) : run(key.action))}
              className={`cursor-pointer text-sm outline-none transition-colors focus-visible:bg-hud-light/85 focus-visible:text-hud-void ${key.wide ? "col-span-2" : ""} ${
                key.label === "="
                  ? "bg-hud-light/80 font-semibold text-hud-void hover:bg-hud-light"
                  : operator
                    ? "bg-hud-text/[0.06] text-hud-cyan hover:bg-hud-light/85 hover:text-hud-void"
                    : "bg-hud-text/[0.03] text-hud-text hover:bg-hud-light/85 hover:text-hud-void"
              }`}
            >
              {key.label === "⌫" ? <Delete size={15} strokeWidth={1.6} className="mx-auto" aria-hidden /> : key.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
