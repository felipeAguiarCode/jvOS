import { useState, type MouseEvent, type ReactNode } from "react";
import { ENCODING_LABELS, type Encoding } from "../../../../lib/workspace";
import { MenuPopup } from "../../widgets/WidgetMenu";
import { useCursor, useIde, useStore } from "./context";
import { formatDisk, usageShare } from "./format";

const ENCODINGS = Object.keys(ENCODING_LABELS) as Encoding[];

/**
 * termide's bottom line: "Modo: Texto | Edição: Sim | Sintaxe: Python | Tab: 4 | EOL: LF |
 * Codificação: UTF-8 | Pos: 13:1", the last message in the middle, the project's drive on the right.
 */
export function IdeStatusBar() {
  const store = useStore();
  const { active, buffers, notice, disk } = useIde();
  const cursor = useCursor();
  const meta = buffers.find((buffer) => buffer.id === active) ?? null;
  const [encodingMenu, setEncodingMenu] = useState<{ x: number; y: number } | null>(null);
  const text = meta?.view === "text";
  const mode = !meta ? "—" : meta.view === "binary" ? "Binário" : meta.view === "large" ? "Grande" : meta.kind === "virtual" ? (meta.highlight === "Diff" ? "Diff" : "Log") : "Texto";

  const cycleTab = () => {
    if (!meta || !text) return;
    const steps: [number, boolean][] = [
      [2, false],
      [4, false],
      [8, false],
      [meta.tabSize, true],
    ];
    const index = steps.findIndex(([size, tabs]) => size === meta.tabSize && tabs === meta.useTabs);
    const [size, tabs] = steps[(index + 1) % steps.length];
    store.setIndent(meta.id, size, tabs);
  };

  const openEncodings = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setEncodingMenu({ x: box.left, y: box.top - 4 });
  };

  return (
    <div data-testid="ide-status" className="flex h-[18px] shrink-0 items-center gap-0 bg-hud-text/[0.06] px-1 text-[11px] leading-[18px] whitespace-nowrap">
      <Item label="Modo" value={mode} />
      <Item label="Edição" value={!meta ? "—" : meta.readOnly || !text ? "Não" : "Sim"} />
      <Item label="Sintaxe" value={meta?.highlight ?? "Texto"} onClick={text && meta?.kind !== "virtual" ? () => store.openPalette("language") : undefined} />
      <Item label="Tab" value={!meta ? "—" : meta.useTabs ? "tab" : String(meta.tabSize)} onClick={text ? cycleTab : undefined} />
      <Item label="EOL" value={meta ? `${meta.eol.toUpperCase()}${meta.mixedEol ? "*" : ""}` : "—"} onClick={text && meta?.kind !== "virtual" ? () => store.setEol(meta!.id, meta!.eol === "crlf" ? "lf" : "crlf") : undefined} />
      <Item label="Codificação" value={meta ? ENCODING_LABELS[meta.encoding] : "—"} onClick={text && meta?.kind === "file" ? openEncodings : undefined} />
      <Item label="Pos" value={text ? `${cursor.line}:${cursor.col}${cursor.selected ? ` (${cursor.selected})` : ""}` : "—"} onClick={text ? () => store.openPalette("line") : undefined} last />
      <span role="status" className={`min-w-0 flex-1 truncate px-2 text-center ${notice?.tone === "error" ? "text-hud-alert" : "text-hud-light/85"}`}>
        {notice?.text}
      </span>
      {disk && <span className={usageShare(disk) >= 0.95 ? "text-hud-alert" : "text-hud-light/80"}>{formatDisk(disk)}</span>}
      {encodingMenu && meta && (
        <MenuPopup
          at={encodingMenu}
          label="Codificação ao salvar"
          sections={[{ title: "Salvar como", items: ENCODINGS.map((encoding) => ({ kind: "radio" as const, label: ENCODING_LABELS[encoding], checked: meta.encoding === encoding, onSelect: () => (store.setEncoding(meta.id, encoding), setEncodingMenu(null)) })) }]}
          container={store.container}
          onClose={() => setEncodingMenu(null)}
          onDismiss={() => setEncodingMenu(null)}
        />
      )}
    </div>
  );
}

function Item({ label, value, onClick, last = false }: { label: string; value: ReactNode; onClick?: (event: MouseEvent<HTMLButtonElement>) => void; last?: boolean }) {
  const content = (
    <>
      <span className="text-hud-text/50">{label}: </span>
      <span className="text-hud-light">{value}</span>
    </>
  );
  return (
    <>
      {onClick ? (
        <button type="button" onClick={onClick} title={`${label}: clique para mudar`} className="cursor-pointer px-1 outline-none hover:bg-hud-light/15 focus-visible:bg-hud-light/15">
          {content}
        </button>
      ) : (
        <span className="px-1">{content}</span>
      )}
      {!last && <span className="text-hud-text/30">|</span>}
    </>
  );
}
