import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { WrapText } from "lucide-react";
import { useEditorDocument } from "../../../hooks/useEditorDocument";
import { baseName, type FileFilter } from "../../../lib/files";
import { CodeMirror, type CursorInfo } from "./CodeMirror";
import { ConfirmBar, FileButtons, StatusBar, StatusItem, ToolButton, Toolbar, ToolSeparator } from "./editorChrome";

const FILTERS: FileFilter[] = [{ name: "Todos os arquivos", extensions: ["*"] }];

/** Languages offered in the picker (those the language pack knows). */
const PICKER = [
  "JavaScript", "TypeScript", "JSX", "TSX", "JSON", "HTML", "CSS", "SCSS", "Markdown", "Python", "Rust", "Go", "Java", "C", "C++",
  "C#", "Shell", "PowerShell", "SQL", "YAML", "TOML", "XML", "PHP", "Ruby", "Kotlin", "Swift", "Dockerfile", "Lua", "Dart",
]
  .map((name) => LanguageDescription.matchLanguageName(languages, name, false))
  .filter((description): description is LanguageDescription => description !== null);

const BADGES: Record<string, string> = {
  JavaScript: "JS",
  TypeScript: "TS",
  Python: "PY",
  Rust: "RS",
  Markdown: "MD",
  "C++": "CPP",
  "C#": "CS",
  Shell: "SH",
  PowerShell: "PS",
  YAML: "YML",
  Ruby: "RB",
  Kotlin: "KT",
  Dockerfile: "DOCK",
};

/** Short badge for the status line. */
function badgeOf(description: LanguageDescription | null) {
  if (!description) return "TXT";
  return BADGES[description.name] ?? description.name.slice(0, 4).toUpperCase();
}

/** Code editor: syntax from the file name or the picker, loaded on demand. */
export function CodeEditor() {
  const document = useEditorDocument("code", FILTERS, "sem-titulo.txt");
  const [wrap, setWrap] = useState(false);
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, col: 1, selected: 0, lines: 1 });
  const [support, setSupport] = useState<{ name: string; extension: Extension } | null>(null);

  const description = useMemo(() => {
    if (document.language) return LanguageDescription.matchLanguageName(languages, document.language, false);
    return document.path ? LanguageDescription.matchFilename(languages, baseName(document.path)) : null;
  }, [document.language, document.path]);

  useEffect(() => {
    if (!description) return setSupport(null);
    let stale = false;
    void description.load().then((loaded) => {
      if (!stale) setSupport({ name: description.name, extension: loaded });
    });
    return () => {
      stale = true;
    };
  }, [description]);

  const crlf = document.content.includes("\r\n");

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "s") void (event.shiftKey ? document.saveAs() : document.save());
    else if (key === "o") document.openFile();
    else if (key === "n") document.newFile();
    else return;
    event.preventDefault();
  };

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <Toolbar>
        <FileButtons document={document} />
        <ToolSeparator />
        <select
          aria-label="Linguagem"
          value={description?.name ?? ""}
          onChange={(event) => document.setLanguage(event.target.value || null)}
          className="hud-input h-7 cursor-pointer py-0 pr-6 pl-2 text-xs"
        >
          <option value="" className="bg-hud-panel">
            Texto
          </option>
          {PICKER.map((item) => (
            <option key={item.name} value={item.name} className="bg-hud-panel">
              {item.name}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <ToolButton label="Quebrar linhas" active={wrap} onClick={() => setWrap((value) => !value)}>
          <WrapText size={14} strokeWidth={1.6} />
        </ToolButton>
      </Toolbar>
      <ConfirmBar document={document} />
      <div className="min-h-0 flex-1">
        <CodeMirror
          doc={document.content}
          onChange={document.setContent}
          onCursor={setCursor}
          language={support?.extension ?? null}
          wrap={wrap}
          placeholder="// Cole ou escreva código…"
        />
      </div>
      <StatusBar badge={badgeOf(description)} document={document}>
        <StatusItem>
          Ln {cursor.line}, Col {cursor.col}
        </StatusItem>
        {cursor.selected > 0 && <StatusItem>{cursor.selected} sel</StatusItem>}
        <StatusItem>{cursor.lines} linhas</StatusItem>
        <StatusItem>{crlf ? "CRLF" : "LF"}</StatusItem>
        <StatusItem>UTF-8</StatusItem>
        <StatusItem>{description?.name ?? "Texto"}</StatusItem>
      </StatusBar>
    </div>
  );
}
