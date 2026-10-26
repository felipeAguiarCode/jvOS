import { hasKind } from "./layout";
import type { IdeStore } from "./store";
import type { IdeState } from "./types";

/** Everything jv_ide can do by name: the menus, the command palette and the shortcuts share it. */
export interface Command {
  id: string;
  title: string;
  /** Shown next to the title ("Ctrl+S"). */
  keys?: string;
  run: () => void;
  enabled?: boolean;
  checked?: boolean;
}

interface KeySpec {
  /** `event.key`, lower case. */
  key?: string;
  /** `event.code`, for keys whose character depends on the layout (` on ABNT2 is '). */
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

interface Binding {
  spec: KeySpec;
  command: string;
  /** Also from inside a terminal panel (the others belong to the shell there). */
  terminal?: boolean;
}

/** F5/Ctrl+R (reload), F11 (fullscreen), F12, Ctrl+Q and Ctrl+M (JARVIS) stay out on purpose. */
const BINDINGS: Binding[] = [
  { spec: { key: "o", ctrl: true }, command: "project.open" },
  { spec: { key: "p", ctrl: true }, command: "palette.files" },
  { spec: { key: "p", ctrl: true, shift: true }, command: "palette.commands", terminal: true },
  { spec: { key: "f1" }, command: "palette.commands", terminal: true },
  { spec: { key: "g", ctrl: true }, command: "palette.line" },
  { spec: { key: "o", ctrl: true, shift: true }, command: "palette.symbols" },
  { spec: { key: "f", ctrl: true, shift: true }, command: "search.focus", terminal: true },
  { spec: { key: "f4" }, command: "search.next" },
  { spec: { key: "f4", shift: true }, command: "search.prev" },
  { spec: { key: "n", ctrl: true }, command: "file.new" },
  { spec: { key: "s", ctrl: true }, command: "file.save" },
  { spec: { key: "s", ctrl: true, shift: true }, command: "file.saveAs" },
  { spec: { key: "s", ctrl: true, alt: true }, command: "file.saveAll" },
  { spec: { key: "w", ctrl: true }, command: "tab.close" },
  { spec: { key: "f4", ctrl: true }, command: "tab.close" },
  { spec: { key: "t", ctrl: true, shift: true }, command: "tab.reopen" },
  { spec: { key: "tab", ctrl: true }, command: "tab.next" },
  { spec: { key: "tab", ctrl: true, shift: true }, command: "tab.prev" },
  { spec: { key: "pagedown", ctrl: true }, command: "tab.next" },
  { spec: { key: "pageup", ctrl: true }, command: "tab.prev" },
  { spec: { key: "b", ctrl: true }, command: "panel.files" },
  { spec: { key: "e", ctrl: true, shift: true }, command: "tree.reveal", terminal: true },
  { spec: { key: "g", ctrl: true, shift: true }, command: "git.focus", terminal: true },
  { spec: { code: "Backquote", ctrl: true }, command: "terminal.toggle", terminal: true },
  { spec: { code: "Backquote", ctrl: true, shift: true }, command: "terminal.new", terminal: true },
  { spec: { key: "f6" }, command: "panel.next", terminal: true },
  { spec: { key: "f6", shift: true }, command: "panel.prev", terminal: true },
  { spec: { key: "z", alt: true }, command: "view.wrap" },
  { spec: { key: "=", ctrl: true }, command: "view.fontUp" },
  { spec: { key: "+", ctrl: true }, command: "view.fontUp" },
  { spec: { key: "-", ctrl: true }, command: "view.fontDown" },
  { spec: { key: "0", ctrl: true }, command: "view.fontReset" },
  { spec: { key: "f10" }, command: "menu.focus" },
];

const matches = (event: KeyboardEvent, spec: KeySpec) =>
  (event.ctrlKey || event.metaKey) === !!spec.ctrl &&
  event.shiftKey === !!spec.shift &&
  event.altKey === !!spec.alt &&
  (spec.code ? event.code === spec.code : event.key.toLowerCase() === spec.key);

/** The command a key press asks for; Alt+1…9 come back as "panel.focus:N". */
export function commandForKey(event: KeyboardEvent, inTerminal: boolean): string | null {
  if (event.altKey && !event.ctrlKey && !event.shiftKey && /^Digit[1-9]$/.test(event.code)) return `panel.focus:${event.code.slice(5)}`;
  const binding = BINDINGS.find((item) => matches(event, item.spec) && (!inTerminal || item.terminal));
  return binding?.command ?? null;
}

const FONT_SIZES = [12, 13, 14, 15] as const;

export function buildCommands(store: IdeStore, state: IdeState): Map<string, Command> {
  const active = store.buffer(state.active);
  const project = !!state.root;
  const text = active?.view === "text";
  const repo = !!state.git.status;
  const font = (step: number) => () => {
    const index = FONT_SIZES.indexOf(state.prefs.fontSize);
    store.setPrefs({ fontSize: FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, index + step))] });
  };
  const list: Command[] = [
    { id: "project.open", title: "Abrir pasta…", keys: "Ctrl+O", run: () => void store.pickFolder() },
    { id: "project.close", title: "Fechar projeto", run: () => store.closeProject(), enabled: project },
    { id: "project.reveal", title: "Mostrar no Explorer", run: () => state.root && void store.revealInExplorer(state.root), enabled: project },
    { id: "project.copyPath", title: "Copiar caminho do projeto", run: () => state.root && void store.copyText(state.root, "Caminho"), enabled: project },
    { id: "palette.files", title: "Abrir arquivo…", keys: "Ctrl+P", run: () => store.openPalette("files"), enabled: project },
    { id: "palette.commands", title: "Paleta de comandos…", keys: "Ctrl+Shift+P", run: () => store.openPalette("commands") },
    { id: "palette.line", title: "Ir para linha…", keys: "Ctrl+G", run: () => store.openPalette("line"), enabled: text },
    { id: "palette.symbols", title: "Ir para símbolo…", keys: "Ctrl+Shift+O", run: () => store.openPalette("symbols"), enabled: text },
    { id: "palette.language", title: "Linguagem do arquivo…", run: () => store.openPalette("language"), enabled: text },
    { id: "search.focus", title: "Buscar no projeto", keys: "Ctrl+Shift+F", run: () => store.focusSearch(), enabled: project },
    { id: "search.next", title: "Próximo resultado da busca", keys: "F4", run: () => store.stepMatch(1), enabled: state.search.total > 0 },
    { id: "search.prev", title: "Resultado anterior da busca", keys: "Shift+F4", run: () => store.stepMatch(-1), enabled: state.search.total > 0 },
    { id: "file.new", title: "Novo arquivo", keys: "Ctrl+N", run: () => void store.newUntitled() },
    { id: "file.save", title: "Salvar", keys: "Ctrl+S", run: () => void store.save(), enabled: text && active?.kind !== "virtual" },
    { id: "file.saveAs", title: "Salvar como…", keys: "Ctrl+Shift+S", run: () => store.saveAs(), enabled: text && active?.kind !== "virtual" },
    { id: "file.saveAll", title: "Salvar tudo", keys: "Ctrl+Alt+S", run: () => void store.saveAll() },
    { id: "file.reload", title: "Recarregar do disco", run: () => void store.reloadFromDisk(), enabled: active?.kind === "file" },
    {
      id: "file.eol",
      title: active?.eol === "crlf" ? "Fim de linha: mudar para LF" : "Fim de linha: mudar para CRLF",
      run: () => active && store.setEol(active.id, active.eol === "crlf" ? "lf" : "crlf"),
      enabled: text && active?.kind !== "virtual",
    },
    { id: "file.encodingUtf8", title: "Salvar em UTF-8", run: () => active && store.setEncoding(active.id, "utf8"), enabled: text && active?.kind === "file" && active.encoding !== "utf8" },
    { id: "tab.close", title: "Fechar aba", keys: "Ctrl+W", run: () => store.closeBuffer(), enabled: !!active },
    { id: "tab.reopen", title: "Reabrir aba fechada", keys: "Ctrl+Shift+T", run: () => store.reopenClosed(), enabled: state.closed.length > 0 },
    { id: "tab.next", title: "Próxima aba", keys: "Ctrl+Tab", run: () => store.cycleTab(1), enabled: state.buffers.length > 1 },
    { id: "tab.prev", title: "Aba anterior", keys: "Ctrl+Shift+Tab", run: () => store.cycleTab(-1), enabled: state.buffers.length > 1 },
    { id: "tab.closeSaved", title: "Fechar abas salvas", run: () => store.closeSaved(), enabled: state.buffers.length > 0 },
    { id: "tree.reveal", title: "Mostrar o arquivo na árvore", keys: "Ctrl+Shift+E", run: () => active?.path && store.reveal(active.path), enabled: !!active?.path },
    { id: "panel.editor", title: "Editor", run: () => store.togglePanel("editor"), checked: hasKind(state.layout, "editor") },
    { id: "panel.files", title: "Arquivos", keys: "Ctrl+B", run: () => store.togglePanel("files"), checked: hasKind(state.layout, "files") },
    { id: "panel.git", title: "Git", run: () => store.togglePanel("git"), checked: hasKind(state.layout, "git") },
    { id: "panel.outline", title: "Outline", run: () => store.togglePanel("outline"), checked: hasKind(state.layout, "outline") },
    { id: "panel.search", title: "Busca", run: () => store.togglePanel("search"), checked: hasKind(state.layout, "search") },
    { id: "git.focus", title: "Ir para o Git", keys: "Ctrl+Shift+G", run: () => store.showPanel("git") },
    { id: "terminal.toggle", title: "Terminal", keys: "Ctrl+`", run: () => void store.toggleTerminal() },
    { id: "terminal.new", title: "Novo terminal", keys: "Ctrl+Shift+`", run: () => void store.openTerminal() },
    { id: "panel.next", title: "Próximo painel", keys: "F6", run: () => store.cyclePanel(1) },
    { id: "panel.prev", title: "Painel anterior", keys: "Shift+F6", run: () => store.cyclePanel(-1) },
    { id: "panel.zoom", title: state.layout.zoom ? "Restaurar painéis" : "Ampliar o painel em foco", run: () => store.toggleZoom() },
    { id: "layout.reset", title: "Restaurar layout padrão", run: () => store.resetLayout() },
    { id: "view.wrap", title: "Quebrar linhas", keys: "Alt+Z", run: () => store.setPrefs({ wrap: !state.prefs.wrap }), checked: state.prefs.wrap },
    { id: "view.fontUp", title: "Aumentar a fonte", keys: "Ctrl+=", run: font(1) },
    { id: "view.fontDown", title: "Diminuir a fonte", keys: "Ctrl+-", run: font(-1) },
    { id: "view.fontReset", title: "Fonte padrão", keys: "Ctrl+0", run: () => store.setPrefs({ fontSize: 13 }) },
    { id: "bookmark.toggle", title: active?.path && store.isBookmarked(active.path) ? "Remover dos favoritos" : "Adicionar aos favoritos", run: () => active?.path && store.toggleBookmark(active.path, false), enabled: !!active?.path },
    { id: "git.refresh", title: "Git: atualizar", run: () => void store.refreshGit(), enabled: project },
    { id: "git.stageAll", title: "Git: stage tudo", run: () => void store.stageAll(), enabled: repo },
    { id: "git.unstageAll", title: "Git: unstage tudo", run: () => void store.unstageAll(), enabled: repo },
    { id: "git.revertAll", title: "Git: reverter tudo", run: () => store.discardAll(), enabled: repo },
    { id: "git.commit", title: "Git: commit…", run: () => store.askCommit(), enabled: repo },
    { id: "git.push", title: "Git: push", run: () => void store.push(), enabled: repo },
    { id: "git.pull", title: "Git: pull", run: () => void store.pull(), enabled: repo },
    { id: "git.fetch", title: "Git: fetch", run: () => void store.fetch(), enabled: repo },
    { id: "git.log", title: "Git: log", run: () => void store.openLog(), enabled: repo },
    { id: "git.diff", title: "Git: diff de tudo", run: () => void store.openFullDiff(), enabled: repo },
    { id: "git.stash", title: "Git: guardar no stash…", run: () => store.stashPush(), enabled: repo },
    { id: "git.branch", title: "Git: novo branch…", run: () => store.askNewBranch(), enabled: repo },
  ];
  return new Map(list.map((command) => [command.id, command]));
}
