import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const cyan = (percent: number) => `color-mix(in oklab, var(--color-hud-cyan) ${percent}%, transparent)`;
const text = (percent: number) => `color-mix(in oklab, var(--color-hud-text) ${percent}%, transparent)`;

/**
 * CodeMirror look built only from the `--color-hud-*` variables, so a theme switch recolours
 * the editors at once. The panel of the window shows through the transparent background.
 */
export const hudTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--color-hud-text)", height: "100%", fontSize: "13px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.6",
      scrollbarWidth: "thin",
      scrollbarColor: `${cyan(25)} transparent`,
    },
    ".cm-content": { caretColor: "var(--color-hud-light)", padding: "10px 0" },
    ".cm-line": { padding: "0 12px 0 6px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-hud-light)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: cyan(28),
    },
    ".cm-activeLine": { backgroundColor: cyan(6) },
    ".cm-gutters": { backgroundColor: "transparent", color: text(40), border: "none", fontFamily: "var(--font-mono)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-hud-light)" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "44px" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: cyan(18), outline: `1px solid ${cyan(50)}` },
    ".cm-selectionMatch": { backgroundColor: cyan(14) },
    ".cm-searchMatch": { backgroundColor: "color-mix(in oklab, var(--color-hud-holo) 30%, transparent)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in oklab, var(--color-hud-holo) 55%, transparent)" },
    ".cm-panels": { backgroundColor: "var(--color-hud-panel)", color: "var(--color-hud-text)" },
    ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${cyan(15)}` },
    ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${cyan(15)}` },
    ".cm-panel.cm-search": { fontFamily: "var(--font-hud)", fontSize: "12px" },
    ".cm-panel.cm-search label": { color: text(70) },
    ".cm-textfield": { backgroundColor: "rgb(255 255 255 / 0.03)", border: `1px solid ${cyan(15)}`, color: "var(--color-hud-text)", borderRadius: "6px" },
    ".cm-textfield:focus": { borderColor: cyan(55), outline: "none" },
    ".cm-button": { backgroundColor: cyan(10), backgroundImage: "none", border: `1px solid ${cyan(25)}`, color: "var(--color-hud-light)", borderRadius: "6px" },
    ".cm-button:active": { backgroundColor: cyan(20), backgroundImage: "none" },
    ".cm-tooltip": { backgroundColor: "var(--color-hud-panel)", border: `1px solid ${cyan(20)}`, color: "var(--color-hud-text)" },
    ".cm-placeholder": { color: text(35) },
  },
  { dark: true },
);

/** Syntax colours from the same palette: keywords light, strings warm holo, comments dim. */
export const hudHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--color-hud-light)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: "color-mix(in oklab, var(--color-hud-holo) 70%, #ffffff)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: text(45), fontStyle: "italic" },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: "var(--color-hud-glow)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName), t.macroName], color: "var(--color-hud-cyan)" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.tagName)], color: "var(--color-hud-light)", fontWeight: "500" },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: "color-mix(in oklab, var(--color-hud-text) 85%, var(--color-hud-light))" },
  { tag: [t.variableName, t.name], color: "var(--color-hud-text)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: text(70) },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: text(55) },
  { tag: t.invalid, color: "var(--color-hud-alert)", textDecoration: "underline wavy" },
  // Markdown
  { tag: t.heading, color: "var(--color-hud-light)", fontWeight: "600" },
  { tag: t.heading1, fontSize: "1.25em" },
  { tag: t.heading2, fontSize: "1.1em" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700", color: "var(--color-hud-glow)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: text(50) },
  { tag: [t.link, t.url], color: "var(--color-hud-cyan)", textDecoration: "underline" },
  { tag: t.monospace, color: "var(--color-hud-holo)" },
  { tag: t.quote, color: text(70), fontStyle: "italic" },
  { tag: [t.list, t.contentSeparator], color: "var(--color-hud-cyan)" },
]);
