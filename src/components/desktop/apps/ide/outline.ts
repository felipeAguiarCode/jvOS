import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { outlineByRegex } from "./outlineRegex";

/**
 * The Outline panel's symbols, read from the editor's own syntax tree (Lezer grammars) or, for the
 * legacy stream modes, line by line (outlineRegex.ts). Pure: no React, no DOM.
 */

/** f function, m method, c class/struct, i interface/trait, t type/enum, v variable/field, n namespace/module, k key/selector, h heading. */
export type SymbolKind = "f" | "m" | "c" | "i" | "t" | "v" | "n" | "k" | "h";

export interface OutlineSymbol {
  kind: SymbolKind;
  name: string;
  /** 1-based. */
  line: number;
  /** Where the name (or the declaration) starts. */
  from: number;
  /** 0 at the top; +1 inside a class, namespace, function… */
  depth: number;
}

/** The panel lists at most this many. */
export const MAX_SYMBOLS = 2000;
/** Longer documents get no outline. */
export const MAX_OUTLINE_DOC = 2 * 1024 * 1024;
/** Milliseconds the outline may spend finishing the parse; past that it uses what is parsed. */
const PARSE_BUDGET = 50;

interface Hit {
  name: string;
  from: number;
  kind?: SymbolKind;
  /** A function or class held by a variable (`const f = () => …`): what it holds nests under it. */
  value?: SyntaxNode | null;
}

type FrameKind = SymbolKind | "scope";

/** An open container while walking: a symbol, or a function body that is not one ("scope"). */
interface Frame {
  kind: FrameKind;
  /** Depth of what it holds. */
  depth: number;
  from: number;
  to: number;
  type: number;
}

interface Context {
  state: EditorState;
  frames: readonly Frame[];
}

interface Rule {
  kind: SymbolKind;
  /** The first direct child of one of these types names it; or a reader for anything else. */
  name: readonly string[] | ((node: SyntaxNode, context: Context) => Hit[]);
  /** What it holds nests under it (classes, functions, namespaces, keys). */
  container?: boolean;
  /** Variables and fields: never the locals of a function. */
  variable?: boolean;
  /** A function directly inside a class or trait is a method. */
  method?: boolean;
  /** Deeper than this it is left out, with everything inside (JSON and YAML keys). */
  maxDepth?: number;
  /** A fixed depth instead of the nesting (Markdown headings, by level). */
  depth?: (node: SyntaxNode) => number;
}

interface Grammar {
  rules: Record<string, Rule>;
  /** Function bodies that are not symbols (arrow functions, lambdas): their variables are locals. */
  scopes?: readonly string[];
}

const FUNCTION_FRAMES = new Set<FrameKind>(["f", "m", "scope"]);
const CLASS_FRAMES = new Set<FrameKind>(["c", "i", "t"]);
/** Values that make the variable holding them a function or a class. */
const VALUES = new Set(["ArrowFunction", "FunctionExpression", "ClassExpression"]);

const textOf = (state: EditorState, from: number, to: number) => state.doc.sliceString(from, to);
const unquote = (value: string) => value.replace(/^(["'`])([\s\S]*)\1$/, "$2");
/** Whitespace collapsed, cut to `max` characters. */
const oneLine = (value: string, max = 60) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function firstChild(node: SyntaxNode, types: readonly string[]) {
  for (const type of types) {
    const child = node.getChild(type);
    if (child) return child;
  }
  return null;
}

/** Named by the first direct child of one of `types`. */
const childName =
  (types: readonly string[]) =>
  (node: SyntaxNode, { state }: Context): Hit[] => {
    const child = firstChild(node, types);
    return child ? [{ name: unquote(textOf(state, child.from, child.to)), from: child.from }] : [];
  };

/** One symbol per declarator (`int a = 1, b = 2;`), named by its first child of `types`. */
const declarators =
  (types: readonly string[]) =>
  (node: SyntaxNode, { state }: Context): Hit[] =>
    node.getChildren("VariableDeclarator").flatMap((declarator) => {
      const name = firstChild(declarator, types);
      return name ? [{ name: textOf(state, name.from, name.to), from: name.from }] : [];
    });

/** Every direct child of `type` is a name (`var a, b int`). */
const allNamed =
  (type: string) =>
  (node: SyntaxNode, { state }: Context): Hit[] =>
    node.getChildren(type).map((name) => ({ name: textOf(state, name.from, name.to), from: name.from }));

const read = (rule: Rule, node: SyntaxNode, context: Context) =>
  typeof rule.name === "function" ? rule.name(node, context) : childName(rule.name)(node, context);

// JavaScript, TypeScript, JSX, TSX

/** `const a = 1, f = () => …`: one symbol per name; a function or class value makes it one. */
function jsVariables(node: SyntaxNode, { state }: Context): Hit[] {
  if (node.parent?.name.startsWith("For")) return []; // for (const item of …)
  const hits: Hit[] = [];
  let current: Hit | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "VariableDefinition") {
      current = { name: textOf(state, child.from, child.to), from: child.from, kind: "v" };
      hits.push(current);
    } else if (current && !current.value && VALUES.has(child.name)) {
      current.kind = child.name === "ClassExpression" ? "c" : "f";
      current.value = child;
    }
  }
  return hits;
}

/** A class field; one holding a function is a method. */
function jsField(node: SyntaxNode, { state }: Context): Hit[] {
  const name = firstChild(node, ["PropertyDefinition", "PrivatePropertyDefinition", "PropertyName"]);
  if (!name) return [];
  const value = node.getChild("ArrowFunction") ?? node.getChild("FunctionExpression");
  return [{ name: textOf(state, name.from, name.to), from: name.from, kind: value ? "m" : "v", value }];
}

const JS: Grammar = {
  scopes: ["ArrowFunction", "FunctionExpression", "ClassExpression"],
  rules: {
    FunctionDeclaration: { kind: "f", name: ["VariableDefinition"], container: true },
    AmbientFunctionDeclaration: { kind: "f", name: ["VariableDefinition"] },
    ClassDeclaration: { kind: "c", name: ["VariableDefinition", "TypeDefinition"], container: true },
    MethodDeclaration: { kind: "m", name: ["PropertyDefinition", "PrivatePropertyDefinition", "PropertyName"], container: true },
    PropertyDeclaration: { kind: "v", name: jsField, variable: true },
    InterfaceDeclaration: { kind: "i", name: ["TypeDefinition"] },
    TypeAliasDeclaration: { kind: "t", name: ["TypeDefinition"] },
    EnumDeclaration: { kind: "t", name: ["TypeDefinition"] },
    NamespaceDeclaration: { kind: "n", name: ["VariableDefinition", "String"], container: true },
    VariableDeclaration: { kind: "v", name: jsVariables, variable: true },
  },
};

// Python

/** `a, b = …` and `count: int = 0`: the names before the first `=`. */
function pythonAssign(node: SyntaxNode, { state }: Context): Hit[] {
  const hits: Hit[] = [];
  for (let child = node.firstChild; child && child.name !== "AssignOp"; child = child.nextSibling)
    if (child.name === "VariableName") hits.push({ name: textOf(state, child.from, child.to), from: child.from });
  return hits;
}

const PYTHON: Grammar = {
  scopes: ["LambdaExpression"],
  rules: {
    FunctionDefinition: { kind: "f", name: ["VariableName"], container: true, method: true },
    ClassDefinition: { kind: "c", name: ["VariableName"], container: true },
    AssignStatement: { kind: "v", name: pythonAssign, variable: true },
  },
};

// Rust

/** `impl<T> fmt::Display for Store where …` → "impl fmt::Display for Store". */
function rustImpl(node: SyntaxNode, { state }: Context): Hit[] {
  const keyword = node.getChild("impl");
  let from = keyword?.to ?? node.from;
  if (keyword?.nextSibling?.name === "TypeParamList") from = keyword.nextSibling.to;
  const head = oneLine(textOf(state, from, node.getChild("DeclarationList")?.from ?? node.to).replace(/\swhere\s[\s\S]*$/, ""));
  return head ? [{ name: `impl ${head}`, from: node.from }] : [];
}

const RUST: Grammar = {
  scopes: ["ClosureExpression"],
  rules: {
    FunctionItem: { kind: "f", name: ["BoundIdentifier"], container: true, method: true },
    StructItem: { kind: "c", name: ["TypeIdentifier"] },
    UnionItem: { kind: "c", name: ["TypeIdentifier"] },
    EnumItem: { kind: "t", name: ["TypeIdentifier"] },
    TraitItem: { kind: "i", name: ["TypeIdentifier"], container: true },
    TypeItem: { kind: "t", name: ["TypeIdentifier"] },
    ImplItem: { kind: "c", name: rustImpl, container: true },
    ModItem: { kind: "n", name: ["BoundIdentifier"], container: true },
    ConstItem: { kind: "v", name: ["BoundIdentifier"], variable: true },
    StaticItem: { kind: "v", name: ["BoundIdentifier"], variable: true },
    MacroDefinition: { kind: "f", name: ["Identifier"] },
  },
};

// Go

/** `type X struct {…}` is a class, `interface {…}` an interface, anything else a type. */
function goType(node: SyntaxNode, { state }: Context): Hit[] {
  const name = node.getChild("DefName");
  if (!name) return [];
  const kind = node.getChild("StructType") ? "c" : node.getChild("InterfaceType") ? "i" : "t";
  return [{ name: textOf(state, name.from, name.to), from: name.from, kind }];
}

const GO: Grammar = {
  scopes: ["FunctionLiteral"],
  rules: {
    FunctionDecl: { kind: "f", name: ["DefName"], container: true },
    MethodDecl: { kind: "m", name: ["FieldName"], container: true },
    TypeSpec: { kind: "t", name: goType },
    ConstSpec: { kind: "v", name: allNamed("DefName"), variable: true },
    VarSpec: { kind: "v", name: allNamed("DefName"), variable: true },
  },
};

// Java

const JAVA: Grammar = {
  scopes: ["LambdaExpression"],
  rules: {
    ClassDeclaration: { kind: "c", name: ["Definition"], container: true },
    RecordDeclaration: { kind: "c", name: ["Definition"], container: true },
    InterfaceDeclaration: { kind: "i", name: ["Definition"], container: true },
    AnnotationTypeDeclaration: { kind: "i", name: ["Identifier"], container: true },
    EnumDeclaration: { kind: "t", name: ["Definition"], container: true },
    MethodDeclaration: { kind: "m", name: ["Definition"], container: true },
    ConstructorDeclaration: { kind: "m", name: ["Definition"], container: true },
    FieldDeclaration: { kind: "v", name: declarators(["Definition"]), variable: true },
    ConstantDeclaration: { kind: "v", name: declarators(["Definition"]), variable: true },
  },
};

// C and C++

const DECLARATOR_NAMES = new Set([
  "Identifier",
  "FieldIdentifier",
  "ScopedIdentifier",
  "DestructorName",
  "OperatorName",
  "TemplateFunction",
  "ScopedFieldIdentifier",
  "OperatorCast",
]);

/** The FunctionDeclarator of a definition, under any pointer or reference declarators. */
function functionDeclarator(node: SyntaxNode): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "FunctionDeclarator") return child;
    if (child.name.endsWith("Declarator")) {
      const inner = functionDeclarator(child);
      if (inner) return inner;
    }
  }
  return null;
}

/** `int Store::count()` is a method; so is anything defined inside a class body. */
function cppFunction(node: SyntaxNode, { state }: Context): Hit[] {
  const name = functionDeclarator(node)?.firstChild;
  if (!name || !DECLARATOR_NAMES.has(name.name)) return [];
  const text = oneLine(textOf(state, name.from, name.to), 80);
  return [{ name: text, from: name.from, kind: text.includes("::") ? "m" : undefined }];
}

/** Only definitions with a body: `struct Fwd;` and `struct Item x;` are not symbols. */
const withBody = (body: string, types: readonly string[]) => (node: SyntaxNode, context: Context) =>
  node.getChild(body) ? childName(types)(node, context) : [];

const TYPE_NAMES = ["TypeIdentifier", "ScopedTypeIdentifier", "TemplateType"];

const CPP: Grammar = {
  scopes: ["LambdaExpression"],
  rules: {
    FunctionDefinition: { kind: "f", name: cppFunction, container: true, method: true },
    ClassSpecifier: { kind: "c", name: withBody("FieldDeclarationList", TYPE_NAMES), container: true },
    StructSpecifier: { kind: "c", name: withBody("FieldDeclarationList", TYPE_NAMES), container: true },
    UnionSpecifier: { kind: "c", name: withBody("FieldDeclarationList", TYPE_NAMES), container: true },
    EnumSpecifier: { kind: "t", name: withBody("EnumeratorList", TYPE_NAMES) },
    NamespaceDefinition: { kind: "n", name: ["NamespaceIdentifier", "Identifier", "ScopedNamespaceIdentifier"], container: true },
  },
};

// PHP

const PHP: Grammar = {
  scopes: ["FunctionExpression", "ArrowFunction"],
  rules: {
    NamespaceDefinition: { kind: "n", name: ["QualifiedName", "NamespaceName", "Name"], container: true },
    FunctionDefinition: { kind: "f", name: ["Name"], container: true },
    MethodDeclaration: { kind: "m", name: ["Name"], container: true },
    ClassDeclaration: { kind: "c", name: ["Name"], container: true },
    InterfaceDeclaration: { kind: "i", name: ["Name"], container: true },
    TraitDeclaration: { kind: "i", name: ["Name"], container: true },
    EnumDeclaration: { kind: "t", name: ["Name"], container: true },
    ConstDeclaration: { kind: "v", name: declarators(["Name"]), variable: true },
    PropertyDeclaration: { kind: "v", name: declarators(["VariableName"]), variable: true },
  },
};

// CSS, SCSS, Sass, Less

/** The selector or at-rule prelude: everything before the block. */
function prelude(node: SyntaxNode, { state }: Context): Hit[] {
  const head = oneLine(textOf(state, node.from, node.getChild("Block")?.from ?? node.to));
  return head ? [{ name: head, from: node.from }] : [];
}

function keyframes(node: SyntaxNode, { state }: Context): Hit[] {
  const name = node.getChild("KeyframeName");
  return name ? [{ name: `@keyframes ${textOf(state, name.from, name.to)}`, from: node.from }] : [];
}

/** `@mixin glow($c)` (SCSS) or `=glow($c)` (Sass) → "glow". */
function mixin(node: SyntaxNode, { state }: Context): Hit[] {
  const head = textOf(state, node.from, node.getChild("Block")?.from ?? node.to).replace(/^\s*(?:@mixin\s+|=)/, "");
  const name = oneLine(head.split("(")[0]);
  return name ? [{ name, from: node.from }] : [];
}

/** `$primary: …` (SCSS, Sass) or `@primary: …` (Less) at the top of the sheet. */
function styleVariable(node: SyntaxNode, { state, frames }: Context): Hit[] {
  if (frames.length) return [];
  const name = node.firstChild;
  if (!name || !/^(SassVariableName|VariableName|AtKeyword)$/.test(name.name)) return [];
  return [{ name: textOf(state, name.from, name.to).replace(/:$/, ""), from: name.from }];
}

const CSS: Grammar = {
  rules: {
    RuleSet: { kind: "k", name: prelude, container: true },
    MediaStatement: { kind: "k", name: prelude, container: true },
    SupportsStatement: { kind: "k", name: prelude, container: true },
    KeyframesStatement: { kind: "k", name: keyframes },
    MixinStatement: { kind: "f", name: mixin, container: true },
    Declaration: { kind: "v", name: styleVariable },
  },
};

// Markdown

/** The heading's text without its `#` marks or setext underline. */
function heading(node: SyntaxNode, { state }: Context): Hit[] {
  const marks = node.getChildren("HeaderMark");
  let from = node.from;
  let to = node.to;
  if (node.name.startsWith("ATX")) {
    if (marks.length) from = marks[0].to;
    if (marks.length > 1) to = marks[marks.length - 1].from;
  } else if (marks.length) to = marks[0].from;
  const name = oneLine(textOf(state, from, to), 120);
  return name ? [{ name, from: node.from }] : [];
}

/** ATXHeading3 → 2; SetextHeading2 → 1. */
const headingDepth = (node: SyntaxNode) => Number(node.name.slice(-1)) - 1;

const MARKDOWN: Grammar = {
  rules: Object.fromEntries(
    ["ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6", "SetextHeading1", "SetextHeading2"].map((name) => [
      name,
      { kind: "h", name: heading, depth: headingDepth } satisfies Rule,
    ]),
  ),
};

// JSON and YAML: keys, three levels deep

/** `"name"` → name (escapes decoded when it is valid JSON). */
function jsonKey(node: SyntaxNode, { state }: Context): Hit[] {
  const name = node.getChild("PropertyName");
  if (!name) return [];
  const raw = textOf(state, name.from, name.to);
  let text = unquote(raw);
  try {
    text = JSON.parse(raw);
  } catch {
    // Not a valid JSON string (JSON5-like input): the raw text without quotes.
  }
  return [{ name: text, from: name.from }];
}

const JSON_KEYS: Grammar = {
  rules: { Property: { kind: "k", name: jsonKey, container: true, maxDepth: 2 } },
};

const YAML_KEYS: Grammar = {
  rules: { Pair: { kind: "k", name: ["Key"], container: true, maxDepth: 2 } },
};

/** By `LanguageDescription.name`. */
const GRAMMARS: Record<string, Grammar> = {
  JavaScript: JS,
  TypeScript: JS,
  JSX: JS,
  TSX: JS,
  Python: PYTHON,
  Rust: RUST,
  Go: GO,
  Java: JAVA,
  C: CPP,
  "C++": CPP,
  PHP,
  CSS,
  SCSS: CSS,
  Sass: CSS,
  LESS: CSS,
  Markdown: MARKDOWN,
  JSON: JSON_KEYS,
  YAML: YAML_KEYS,
};

/** Variables count at the top level, in namespaces and as fields; not inside function bodies. */
function outsideFunctions(frames: readonly Frame[]) {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (CLASS_FRAMES.has(frames[i].kind)) return true;
    if (FUNCTION_FRAMES.has(frames[i].kind)) return false;
  }
  return true;
}

/** The innermost enclosing symbol's kind, skipping anonymous function bodies. */
function enclosing(frames: readonly Frame[]) {
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].kind !== "scope") return frames[i].kind;
  return null;
}

function fromTree(state: EditorState, grammar: Grammar): OutlineSymbol[] {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET) ?? syntaxTree(state);
  const symbols: OutlineSymbol[] = [];
  const frames: Frame[] = [];
  const context: Context = { state, frames };
  // Functions and classes held by a variable, by where they start: they open a frame under it.
  const held = new Map<number, { kind: SymbolKind; depth: number }>();
  const open = (ref: SyntaxNodeRef, kind: FrameKind, depth: number) => frames.push({ kind, depth, from: ref.from, to: ref.to, type: ref.type.id });

  tree.iterate({
    enter(ref) {
      if (symbols.length >= MAX_SYMBOLS) return false;
      const depth = frames.length ? frames[frames.length - 1].depth : 0;
      const rule = grammar.rules[ref.name];
      if (!rule) {
        const holder = VALUES.has(ref.name) ? held.get(ref.from) : undefined;
        if (holder) {
          held.delete(ref.from);
          open(ref, holder.kind, holder.depth);
        } else if (grammar.scopes?.includes(ref.name)) open(ref, "scope", depth);
        return;
      }
      if (rule.maxDepth !== undefined && depth > rule.maxDepth) return false;
      const node = ref.node;
      const hits = rule.variable && !outsideFunctions(frames) ? [] : read(rule, node, context);
      let first: SymbolKind | null = null;
      for (const hit of hits) {
        if (symbols.length >= MAX_SYMBOLS) break;
        let kind = hit.kind ?? rule.kind;
        if (rule.method && kind === "f") {
          const outer = enclosing(frames);
          if (outer === "c" || outer === "i") kind = "m";
        }
        const at = rule.depth ? rule.depth(node) : depth;
        symbols.push({ kind, name: hit.name, line: state.doc.lineAt(hit.from).number, from: hit.from, depth: at });
        if (hit.value) held.set(hit.value.from, { kind, depth: at + 1 });
        first ??= kind;
      }
      // An anonymous function still makes its variables locals.
      if (rule.container) open(ref, first ?? (FUNCTION_FRAMES.has(rule.kind) ? "scope" : rule.kind), first ? depth + 1 : depth);
    },
    leave(ref) {
      const top = frames[frames.length - 1];
      if (top && top.from === ref.from && top.to === ref.to && top.type === ref.type.id) frames.pop();
    },
  });
  return symbols;
}

/** The document's symbols in order, or none for an unknown language or a document past 2 MB. */
export function outlineOf(state: EditorState, language: string | null): OutlineSymbol[] {
  if (!language || state.doc.length > MAX_OUTLINE_DOC) return [];
  const grammar = GRAMMARS[language];
  if (grammar) return fromTree(state, grammar);
  return outlineByRegex(state.doc, language, MAX_SYMBOLS) ?? [];
}

/** The symbol the cursor is in: the last one starting on or before its line, the deepest on that line. */
export function symbolAt(symbols: readonly OutlineSymbol[], line: number): OutlineSymbol | null {
  let best: OutlineSymbol | null = null;
  for (const symbol of symbols) {
    if (symbol.line > line) break;
    if (!best || symbol.line > best.line || symbol.depth >= best.depth) best = symbol;
  }
  return best;
}
