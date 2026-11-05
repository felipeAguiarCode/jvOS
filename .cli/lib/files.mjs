// Writing the new files: all or nothing, and never over a file that exists.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** @typedef {{ path: string, content: string, note: string }} NewFile */

/** The files of `plan` that already exist (none may, or nothing is written). */
export const taken = (root, files) => files.filter((file) => existsSync(join(root, file.path))).map((file) => file.path);

/**
 * Writes every file, creating folders. The "wx" flag fails on a file that appeared meanwhile.
 * @param {string} root
 * @param {NewFile[]} files
 * @param {(file: NewFile) => void} [onWritten]
 */
export function writeAll(root, files, onWritten = () => {}) {
  const clash = taken(root, files);
  if (clash.length) throw new Error(`já existe: ${clash.join(", ")}`);
  for (const file of files) {
    const full = join(root, file.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.content, { encoding: "utf8", flag: "wx" });
    onWritten(file);
  }
}

/** The paths as a tree, folders first: `├─ src/` … `└─ spec.md`. */
export function tree(paths) {
  const rootNode = new Map();
  for (const path of paths) {
    let node = rootNode;
    for (const part of path.split("/")) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part);
    }
  }
  const lines = [];
  const walk = (node, prefix) => {
    const entries = [...node.entries()].sort(([a, childA], [b, childB]) => Number(childB.size > 0) - Number(childA.size > 0) || a.localeCompare(b));
    entries.forEach(([name, child], index) => {
      const last = index === entries.length - 1;
      // A folder with one folder inside reads as one line: "src/components/desktop/".
      let label = name;
      let inner = child;
      while (inner.size === 1 && [...inner.values()][0].size > 0) {
        const [next, deeper] = [...inner.entries()][0];
        label += `/${next}`;
        inner = deeper;
      }
      lines.push(`${prefix}${last ? "└─ " : "├─ "}${label}${inner.size ? "/" : ""}`);
      if (inner.size) walk(inner, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  walk(rootNode, "");
  return lines;
}
