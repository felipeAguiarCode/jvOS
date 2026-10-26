import type { Branch, Commit, GitBackend, GitChange, GitStatus, Stash } from "./git";
import { unifiedDiff } from "./lineDiff";
import { baseName, dirName, driveOf, isInside, isVolumeRoot, joinPath, relativePath, samePath } from "./paths";
import type { ChangedEvent, Change, DirEntry, Encoding, Eol, FileContent, SearchEvent, SearchMatch, SearchQuery, Stamp, WorkspaceBackend } from "./workspace";
import { FILE_CHANGED } from "./workspace";

/**
 * Development only: projects in memory, with a small git, standing in for the Rust workspace in
 * a browser (`window.__JARVIS_FS__`). Tests drive and inspect it through `window.__JARVIS_FS_FAKE__`.
 */

export interface FakeFile {
  content?: string;
  eol?: Eol;
  encoding?: Encoding;
  binary?: boolean;
  tooLarge?: boolean;
  size?: number;
  readonly?: boolean;
}

export interface FakeGitSeed {
  branch: string;
  branches: string[];
  ahead: number;
  behind: number;
  /** Committed content of the files that differ from the working copy (the rest is as on disk). */
  head?: Record<string, string | null>;
  /** Staged content where it differs from HEAD. */
  index?: Record<string, string | null>;
  /** Subjects of the existing commits, newest first. */
  commits?: string[];
}

export interface FakeProjectSeed {
  files: Record<string, string | FakeFile>;
  dirs?: string[];
  git?: FakeGitSeed | false;
}

export interface FakeSeed {
  projects: Record<string, FakeProjectSeed>;
  /** Answers of the folder picker, in order (null = cancelled); then the first project. */
  picks?: (string | null)[];
}

interface Node {
  path: string;
  kind: "file" | "dir";
  content: string;
  encoding: Encoding;
  eol: Eol;
  binary: boolean;
  tooLarge: boolean;
  size: number;
  modified: number;
  readonly: boolean;
}

interface Repo {
  root: string;
  branch: string;
  branches: string[];
  ahead: number;
  behind: number;
  head: Map<string, string>;
  index: Map<string, string>;
  commits: Commit[];
  stashes: { message: string; time: number; entries: Map<string, { index: string | undefined; work: string | null }> }[];
  pushes: number;
}

export interface FakeLog {
  writes: { path: string; content: string; encoding: Encoding }[];
  created: string[];
  renames: [string, string][];
  trash: string[];
  revealed: string[];
  searches: SearchQuery[];
  git: string[];
}

declare global {
  interface Window {
    __JARVIS_FS_FAKE__?: {
      read: (path: string) => string | null;
      exists: (path: string) => boolean;
      external: {
        write: (path: string, content: string) => void;
        create: (path: string, content?: string) => void;
        remove: (path: string) => void;
      };
      picks: (string | null)[];
      log: FakeLog;
      repo: (root: string) => { branch: string; ahead: number; behind: number; pushes: number; commits: string[]; stashes: number; staged: string[] } | null;
    };
  }
}

const MAX_TEXT = 5 * 1024 * 1024;
const GB = 1024 ** 3;

const REPORT_PY = `"""The daily reorder report: what each store should order today."""

import csv
import io

from .models import Store


def reorder_rows(store: Store) -> list[tuple]:
    """Items below their reorder point, most urgent first."""
    rows = []
    for item in sorted(store.items, key=lambda i: i.on_hand - i.reorder_point):
        if item.needs_reorder:
            rows.append((item.sku, item.name, item.on_hand, item.reorder_point))
    return rows


def to_csv(rows: list[tuple], delimiter: str = ",") -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter)
    writer.writerow(["sku", "name", "on_hand", "reorder_point"])
    writer.writerows(rows)
    return buffer.getvalue()


def render(store: Store) -> str:
    rows = reorder_rows(store)
    if not rows:
        return f"{store.city}: nothing to reorder"
    lines = [f"{store.city}: {len(rows)} item(s) to reorder"]
    for sku, name, on_hand, point, *_ in rows:
        lines.append(f"  {sku:<10} {name:<28} {on_hand:>4} / {point}")
    return "\\n".join(lines)
`;

const MODELS_PY = `from dataclasses import dataclass, field


@dataclass
class Item:
    sku: str
    name: str
    on_hand: int
    reorder_point: int

    @property
    def needs_reorder(self) -> bool:
        return self.on_hand <= self.reorder_point


@dataclass
class Store:
    city: str
    items: list[Item] = field(default_factory=list)

    def total(self) -> int:
        return sum(item.on_hand for item in self.items)
`;

const SUPPLIERS_PY = `SUPPLIERS = {
    "A-100": "Atacado Central",
    "B-220": "Distribuidora Norte",
}


def supplier_of(sku: str) -> str:
    return SUPPLIERS.get(sku, "desconhecido")
`;

const README = `# inventory

Relatório diário de reposição: o que cada loja deve pedir hoje.

## Uso

\`\`\`
python -m inventory.report
\`\`\`
`;

const DEMO: FakeSeed = {
  projects: {
    "C:\\projetos\\inventory": {
      dirs: ["data", "docs"],
      files: {
        ".gitignore": "logs/\n__pycache__/\n*.tmp\n",
        "README.md": README,
        "inventory/__init__.py": "",
        "inventory/models.py": MODELS_PY,
        "inventory/report.py": REPORT_PY,
        "inventory/suppliers.py": SUPPLIERS_PY,
        "data/stores.csv": "city,sku,on_hand\nRecife,A-100,4\nCuritiba,B-220,12\n",
        "docs/guide.md": "# Guia\n\n## Lojas\n\nCada loja tem seus itens.\n\n### Reposição\n\nQuando o estoque cai abaixo do ponto de pedido.\n",
        "tests/test_report.py": "from inventory.report import reorder_rows\n\n\ndef test_empty_store():\n    assert reorder_rows(None) == []\n",
        "web/app.tsx":
          'import { useState } from "react";\n\ninterface Props {\n  city: string;\n}\n\nexport const StoreCard = ({ city }: Props) => {\n  const [open, setOpen] = useState(false);\n  return <button onClick={() => setOpen(!open)}>{city}</button>;\n};\n\nexport function App() {\n  return <StoreCard city="Recife" />;\n}\n',
        "web/style.css": ".store-card {\n  color: #9fe;\n}\n\n@keyframes pulse {\n  from { opacity: 0.4; }\n}\n",
        "src/main.rs":
          'use std::collections::HashMap;\n\nstruct Stock {\n    items: HashMap<String, u32>,\n}\n\nimpl Stock {\n    fn total(&self) -> u32 {\n        self.items.values().sum()\n    }\n}\n\nfn main() {\n    let stock = Stock { items: HashMap::new() };\n    println!("{}", stock.total());\n}\n',
        "cmd/server.go":
          'package main\n\nimport "fmt"\n\ntype Server struct {\n\tPort int\n}\n\nfunc (s *Server) Start() {\n\tfmt.Println("porta", s.Port)\n}\n\nfunc main() {\n\ts := Server{Port: 8080}\n\ts.Start()\n}\n',
        "scripts/build.ps1": { content: 'param([string]$Target = "release")\n\nWrite-Host "Compilando $Target"\nnpm run build\n', eol: "crlf" },
        "legacy/latin1.txt": { content: "Relatório de reposição — versão antiga\nAção: revisar estoque\n", encoding: "windows1252" },
        "java/Inventory.java":
          "package inventory;\n\npublic class Inventory {\n    private int count;\n\n    public int getCount() {\n        return count;\n    }\n}\n",
        "cpp/stock.cpp": "#include <vector>\n\nnamespace stock {\n\nstruct Item {\n    int qty;\n};\n\nint total(const std::vector<Item>& items) {\n    int sum = 0;\n    for (auto& i : items) sum += i.qty;\n    return sum;\n}\n\n}\n",
        "php/api.php": "<?php\n\nclass Api {\n    public function stores(): array {\n        return [];\n    }\n}\n\nfunction boot(): void {}\n",
        "cs/Program.cs": "namespace Inventory;\n\npublic class Program\n{\n    public static void Main(string[] args)\n    {\n        System.Console.WriteLine(\"ok\");\n    }\n}\n",
        "config.json": '{\n  "stores": ["Recife", "Curitiba"],\n  "threshold": 5\n}\n',
        "assets/logo.png": { binary: true, size: 2048 },
        "logs/big.log": { tooLarge: true, size: 12 * 1024 * 1024 },
      },
      git: {
        branch: "main",
        branches: ["main", "feature/csv-export"],
        ahead: 8,
        behind: 0,
        head: {
          "README.md": "# inventory\n\nRelatório diário de reposição.\n",
          "inventory/models.py": MODELS_PY.replace("\n    def total(self) -> int:\n        return sum(item.on_hand for item in self.items)\n", ""),
          "inventory/suppliers.py": SUPPLIERS_PY.replace('    "B-220": "Distribuidora Norte",\n', ""),
        },
        index: { "README.md": README },
        commits: [
          "Relatório em CSV",
          "Ordena pela urgência",
          "Ponto de pedido por item",
          "Lista de fornecedores",
          "Testes do relatório",
          "Estilo do cartão da loja",
          "Servidor em Go",
          "Contagem de estoque em Rust",
          "Primeira versão",
        ],
      },
    },
    "C:\\projetos\\notas": {
      files: {
        "README.md": "# Notas\n\nIdeias soltas.\n",
        "ideias.md": "# Ideias\n\n- jv_ide com git\n- terminal embutido\n",
        "diario/2026-10-25.md": "# 25 de outubro\n\nHoje o jv_ide abriu a primeira pasta.\n",
      },
      git: false,
    },
  },
};

const lower = (path: string) => path.toLowerCase();

/** "*.py", "docs/**", "logs/" against a relative path. */
function globToRegExp(glob: string): RegExp {
  let source = "";
  const pattern = glob.replace(/\\/g, "/").replace(/\/$/, "/**");
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      source += ".*";
      i++;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(pattern.includes("/") ? `^${source}$` : `(^|/)${source}$`, "i");
}

const randomHash = () => Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

export function createFakeWorkspace(option: true | object): WorkspaceBackend {
  const seed = (option === true ? DEMO : option) as FakeSeed;
  const nodes = new Map<string, Node>();
  const repos: Repo[] = [];
  const opened = new Set<string>();
  const listeners = new Set<(event: ChangedEvent) => void>();
  const picks = [...(seed.picks ?? [])];
  const log: FakeLog = { writes: [], created: [], renames: [], trash: [], revealed: [], searches: [], git: [] };
  let clock = Date.UTC(2026, 9, 25, 10, 42);
  let searchId = 0;

  const stamp = (node: Node): Stamp => ({ size: node.size, modified: node.modified });

  const ensureDir = (path: string) => {
    const existing = nodes.get(lower(path));
    if (existing) return existing;
    if (!isVolumeRoot(path)) ensureDir(dirName(path));
    const node: Node = { path, kind: "dir", content: "", encoding: "utf8", eol: "lf", binary: false, tooLarge: false, size: 0, modified: clock, readonly: false };
    nodes.set(lower(path), node);
    return node;
  };

  const putFile = (path: string, file: string | FakeFile) => {
    const spec = typeof file === "string" ? { content: file } : file;
    ensureDir(dirName(path));
    const content = spec.content ?? "";
    const node: Node = {
      path,
      kind: "file",
      content,
      encoding: spec.encoding ?? "utf8",
      eol: spec.eol ?? "lf",
      binary: spec.binary ?? false,
      tooLarge: spec.tooLarge ?? false,
      size: spec.size ?? content.length,
      modified: ++clock,
      readonly: spec.readonly ?? false,
    };
    nodes.set(lower(path), node);
    return node;
  };

  for (const [root, project] of Object.entries(seed.projects)) {
    ensureDir(root);
    for (const dir of project.dirs ?? []) ensureDir(joinPath(root, dir));
    for (const [rel, file] of Object.entries(project.files)) putFile(joinPath(root, rel), file);
    if (project.git) {
      const git = project.git;
      const work = new Map<string, string>();
      for (const [rel, file] of Object.entries(project.files)) {
        const spec = typeof file === "string" ? { content: file } : file;
        if (!spec.binary && !spec.tooLarge) work.set(rel, spec.content ?? "");
      }
      const head = new Map(work);
      for (const [rel, content] of Object.entries(git.head ?? {})) {
        if (content === null) head.delete(rel);
        else head.set(rel, content);
      }
      const index = new Map(head);
      for (const [rel, content] of Object.entries(git.index ?? {})) {
        if (content === null) index.delete(rel);
        else index.set(rel, content);
      }
      const subjects = git.commits ?? ["Primeira versão"];
      const commits = subjects.map((subject, i): Commit => {
        const hash = randomHash();
        return { hash, short: hash.slice(0, 7), author: "Builder", email: "builder@jarvis.local", time: Math.floor(clock / 1000) - i * 3600, refs: i === 0 ? `HEAD -> ${git.branch}` : "", subject };
      });
      repos.push({ root, branch: git.branch, branches: [...git.branches], ahead: git.ahead, behind: git.behind, head, index, commits, stashes: [], pushes: 0 });
    }
  }

  const fail = (message: string): never => {
    throw message;
  };

  const resolve = (root: string, rel: string) => {
    if (rel.split("/").some((part) => part === "..")) fail("Fora da pasta do projeto");
    return joinPath(root, rel);
  };

  const fileNode = (path: string) => {
    const node = nodes.get(lower(path));
    return node && node.kind === "file" ? node : null;
  };

  const children = (dir: string) => [...nodes.values()].filter((node) => !isVolumeRoot(node.path) && samePath(dirName(node.path), dir));

  const descendants = (path: string) => [...nodes.values()].filter((node) => samePath(node.path, path) || isInside(path, node.path));

  const projectOf = (path: string) => Object.keys(seed.projects).find((root) => isInside(root, path)) ?? null;

  const ignoreRules = (project: string) => {
    const gitignore = fileNode(joinPath(project, ".gitignore"));
    return (gitignore?.content ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map(globToRegExp);
  };

  const isIgnored = (path: string) => {
    const project = projectOf(path);
    if (!project) return false;
    const rel = relativePath(project, path);
    if (!rel) return false;
    const rules = ignoreRules(project);
    // A file inside an ignored folder is ignored too.
    const parts = rel.split("/");
    return parts.some((_, i) => rules.some((rule) => rule.test(parts.slice(0, i + 1).join("/"))));
  };

  const emit = (path: string, kind: Change["kind"], git = false) => {
    for (const root of opened) {
      const rel = relativePath(root, path);
      if (rel === null) continue;
      const event: ChangedEvent = { root, changes: rel === "" ? [] : [{ path: rel, kind }], git, rescan: false };
      window.setTimeout(() => listeners.forEach((listener) => listener(event)), 30);
    }
  };

  const emitGit = (repo: Repo) => {
    for (const root of opened) {
      if (!isInside(repo.root, root)) continue;
      const event: ChangedEvent = { root, changes: [], git: true, rescan: false };
      window.setTimeout(() => listeners.forEach((listener) => listener(event)), 30);
    }
  };

  const writeNode = (path: string, content: string) => {
    const existing = fileNode(path);
    if (existing) {
      existing.content = content;
      existing.size = content.length;
      existing.modified = ++clock;
      existing.binary = false;
      existing.tooLarge = false;
      emit(path, "modified");
      return existing;
    }
    const node = putFile(path, content);
    emit(path, "created");
    return node;
  };

  const removeNode = (path: string) => {
    for (const node of descendants(path)) nodes.delete(lower(node.path));
    emit(path, "removed");
  };

  const entry = (node: Node, root: string): DirEntry => ({
    name: baseName(node.path),
    path: relativePath(root, node.path) ?? baseName(node.path),
    kind: node.kind,
    link: false,
    size: node.size,
    modified: node.modified,
    hidden: baseName(node.path).startsWith("."),
    ignored: isIgnored(node.path),
    readonly: node.readonly,
  });

  const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

  // ── git ────────────────────────────────────────────────────────────────

  const repoOf = (root: string) => repos.find((repo) => samePath(repo.root, root) || isInside(repo.root, root)) ?? null;

  const working = (repo: Repo, rel: string) => {
    const node = fileNode(joinPath(repo.root, rel));
    return node ? node.content : null;
  };

  const workFiles = (repo: Repo) =>
    [...nodes.values()]
      .filter((node) => node.kind === "file" && isInside(repo.root, node.path) && !node.binary && !node.tooLarge)
      .map((node) => relativePath(repo.root, node.path)!);

  const change = (path: string, status: string): GitChange => ({ path, origPath: null, status, submodule: false });

  const statusOf = (repo: Repo, root: string): GitStatus => {
    const byPath = (a: GitChange, b: GitChange) => collator.compare(a.path, b.path);
    const staged: GitChange[] = [];
    for (const rel of new Set([...repo.head.keys(), ...repo.index.keys()])) {
      const head = repo.head.get(rel);
      const index = repo.index.get(rel);
      if (head !== index) staged.push(change(rel, head === undefined ? "A" : index === undefined ? "D" : "M"));
    }
    const unstaged: GitChange[] = [];
    for (const [rel, index] of repo.index) {
      const work = working(repo, rel);
      if (work === null) unstaged.push(change(rel, "D"));
      else if (work !== index) unstaged.push(change(rel, "M"));
    }
    const untracked = workFiles(repo)
      .filter((rel) => !repo.index.has(rel) && !repo.head.has(rel) && !isIgnored(joinPath(repo.root, rel)))
      .map((rel) => change(rel, "?"));
    return {
      repoRoot: repo.root,
      prefix: relativePath(repo.root, root) ?? "",
      branch: repo.branch,
      head: repo.commits[0]?.short ?? null,
      detached: false,
      initial: repo.commits.length === 0,
      upstream: `origin/${repo.branch}`,
      ahead: repo.ahead,
      behind: repo.behind,
      stash: repo.stashes.length,
      staged: staged.sort(byPath),
      unstaged: unstaged.sort(byPath),
      untracked: untracked.map((item) => item).sort(byPath),
      conflicted: [],
      operation: null,
      truncated: false,
    };
  };

  const needRepo = (root: string) => repoOf(root) ?? fail("Não é um repositório git");

  const setWorking = (repo: Repo, rel: string, content: string | undefined) => {
    const path = joinPath(repo.root, rel);
    if (content === undefined) {
      if (fileNode(path)) removeNode(path);
    } else if (working(repo, rel) !== content) writeNode(path, content);
  };

  const mutate = async <T>(root: string, name: string, run: (repo: Repo) => T): Promise<T> => {
    const repo = needRepo(root);
    log.git.push(name);
    const result = run(repo);
    emitGit(repo);
    return result;
  };

  const git: GitBackend = {
    status: async (root) => {
      const repo = repoOf(root);
      return repo ? statusOf(repo, root) : null;
    },
    stage: (root, paths) =>
      mutate(root, `stage ${paths.join(" ")}`, (repo) => {
        for (const rel of paths) {
          const work = working(repo, rel);
          if (work === null) repo.index.delete(rel);
          else repo.index.set(rel, work);
        }
      }),
    unstage: (root, paths) =>
      mutate(root, `unstage ${paths.join(" ")}`, (repo) => {
        for (const rel of paths) {
          const head = repo.head.get(rel);
          if (head === undefined) repo.index.delete(rel);
          else repo.index.set(rel, head);
        }
      }),
    discard: (root, paths) =>
      mutate(root, `discard ${paths.join(" ")}`, (repo) => {
        for (const rel of paths) {
          if (repo.index.has(rel)) setWorking(repo, rel, repo.index.get(rel));
          else {
            log.trash.push(joinPath(repo.root, rel));
            setWorking(repo, rel, undefined);
          }
        }
      }),
    stageAll: (root) =>
      mutate(root, "stage all", (repo) => {
        for (const rel of [...repo.index.keys()]) if (working(repo, rel) === null) repo.index.delete(rel);
        for (const rel of workFiles(repo)) if (!isIgnored(joinPath(repo.root, rel))) repo.index.set(rel, working(repo, rel)!);
      }),
    unstageAll: (root) =>
      mutate(root, "unstage all", (repo) => {
        repo.index = new Map(repo.head);
      }),
    discardAll: (root, untracked) =>
      mutate(root, `discard all${untracked ? " +untracked" : ""}`, (repo) => {
        for (const [rel, content] of repo.index) setWorking(repo, rel, content);
        if (!untracked) return;
        for (const rel of workFiles(repo)) {
          if (repo.index.has(rel) || repo.head.has(rel) || isIgnored(joinPath(repo.root, rel))) continue;
          log.trash.push(joinPath(repo.root, rel));
          setWorking(repo, rel, undefined);
        }
      }),
    commit: (root, message, amend) =>
      mutate(root, `commit ${message}`, (repo) => {
        if (!message.trim()) fail("Escreva a mensagem do commit");
        const same = repo.head.size === repo.index.size && [...repo.index].every(([rel, content]) => repo.head.get(rel) === content);
        if (same && !amend) fail("Nenhuma alteração preparada (stage) para o commit");
        repo.head = new Map(repo.index);
        const hash = randomHash();
        const commit: Commit = { hash, short: hash.slice(0, 7), author: "Builder", email: "builder@jarvis.local", time: Math.floor(Date.now() / 1000), refs: `HEAD -> ${repo.branch}`, subject: message.split("\n")[0] };
        if (repo.commits[0]) repo.commits[0] = { ...repo.commits[0], refs: "" };
        if (amend && repo.commits.length) repo.commits[0] = commit;
        else {
          repo.commits.unshift(commit);
          repo.ahead++;
        }
        return commit.short;
      }),
    push: (root) =>
      mutate(root, "push", (repo) => {
        repo.pushes++;
        repo.ahead = 0;
        return `Enviado para origin/${repo.branch}`;
      }),
    pull: (root) =>
      mutate(root, "pull", (repo) => {
        repo.behind = 0;
        return "Já atualizado";
      }),
    fetch: (root) => mutate(root, "fetch", () => ""),
    log: async (root, limit, skip) => needRepo(root).commits.slice(skip, skip + limit),
    diff: async (root, path, staged) => {
      const repo = needRepo(root);
      const text = staged
        ? unifiedDiff(path, repo.head.get(path) ?? null, repo.index.get(path) ?? null)
        : unifiedDiff(path, repo.index.get(path) ?? (repo.head.has(path) ? "" : null), working(repo, path));
      return { text, binary: false, truncated: false };
    },
    showFile: async (root, path, rev) => {
      const repo = needRepo(root);
      return (rev === "HEAD" ? repo.head.get(path) : repo.index.get(path)) ?? null;
    },
    stashList: async (root) => needRepo(root).stashes.map((stash, index): Stash => ({ index, time: stash.time, message: stash.message })),
    stashPush: (root, message, untracked) =>
      mutate(root, "stash push", (repo) => {
        const entries = new Map<string, { index: string | undefined; work: string | null }>();
        const touched = new Set([...repo.index.keys(), ...repo.head.keys()]);
        if (untracked) for (const rel of workFiles(repo)) if (!isIgnored(joinPath(repo.root, rel))) touched.add(rel);
        for (const rel of touched) {
          const index = repo.index.get(rel);
          const work = working(repo, rel);
          if (index !== repo.head.get(rel) || work !== (index ?? null)) entries.set(rel, { index, work });
        }
        if (!entries.size) fail("Nada para guardar no stash");
        repo.index = new Map(repo.head);
        for (const rel of entries.keys()) setWorking(repo, rel, repo.head.get(rel));
        repo.stashes.unshift({ message: message || `WIP on ${repo.branch}: ${repo.commits[0]?.subject ?? ""}`, time: Math.floor(Date.now() / 1000), entries });
      }),
    stashPop: (root, index) =>
      mutate(root, `stash pop ${index}`, (repo) => {
        const stash = repo.stashes[index] ?? fail("Não há stash");
        for (const [rel, saved] of stash.entries) {
          if (saved.index === undefined) repo.index.delete(rel);
          else repo.index.set(rel, saved.index);
          setWorking(repo, rel, saved.work ?? undefined);
        }
        repo.stashes.splice(index, 1);
      }),
    stashDrop: (root, index) =>
      mutate(root, `stash drop ${index}`, (repo) => {
        if (!repo.stashes[index]) fail("Não há stash");
        repo.stashes.splice(index, 1);
      }),
    branches: async (root) => {
      const repo = needRepo(root);
      return [
        ...repo.branches.map((name): Branch => ({ name, remote: false, current: name === repo.branch, upstream: name === "main" ? "origin/main" : null })),
        { name: "origin/main", remote: true, current: false, upstream: null },
      ];
    },
    checkout: (root, branch, create) =>
      mutate(root, `checkout ${create ? "-b " : ""}${branch}`, (repo) => {
        if (create) {
          if (repo.branches.includes(branch)) fail("Já existe um branch com esse nome");
          repo.branches.push(branch);
        } else if (!repo.branches.includes(branch)) fail("Branch não encontrado");
        repo.branch = branch;
      }),
  };

  // ── search ─────────────────────────────────────────────────────────────

  const searchFiles = (root: string) =>
    [...nodes.values()]
      .filter((node) => node.kind === "file" && isInside(root, node.path) && !isIgnored(node.path) && !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(node.path))
      .map((node) => relativePath(root, node.path)!)
      .sort(collator.compare);

  const backend: WorkspaceBackend = {
    pickFolder: async () => (picks.length ? picks.shift()! : Object.keys(seed.projects)[0]),
    open: async (path) => {
      const node = nodes.get(lower(path));
      if (!node || node.kind !== "dir") fail("Pasta não encontrada");
      if (isVolumeRoot(path)) fail("Abra uma pasta de projeto, não a raiz da unidade");
      opened.add(node!.path);
      const repo = repoOf(node!.path);
      return {
        root: node!.path,
        name: baseName(node!.path),
        repo: repo ? { root: repo.root, prefix: relativePath(repo.root, node!.path) ?? "" } : null,
        watching: true,
      };
    },
    close: async (root) => {
      for (const path of opened) if (samePath(path, root)) opened.delete(path);
    },
    list: async (root, path) => {
      const dir = resolve(root, path);
      const node = nodes.get(lower(dir));
      if (!node || node.kind !== "dir") fail("Pasta não encontrada");
      const entries = children(dir)
        .map((child) => entry(child, root))
        .sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === "dir" ? -1 : 1));
      return { path, entries, truncated: false };
    },
    read: async (root, path): Promise<FileContent> => {
      const node = fileNode(resolve(root, path)) ?? fail("Arquivo não encontrado");
      if (node.binary) return { kind: "binary", stamp: stamp(node) };
      if (node.tooLarge) return { kind: "tooLarge", stamp: stamp(node), max: MAX_TEXT };
      return { kind: "text", contents: node.content, encoding: node.encoding, eol: node.eol, mixedEol: false, stamp: stamp(node), readonly: node.readonly };
    },
    write: async (root, path, contents, encoding, eol, expected) => {
      const target = resolve(root, path);
      const node = fileNode(target);
      if (expected && (!node || node.modified !== expected.modified || node.size !== expected.size)) fail(FILE_CHANGED);
      if (node?.readonly) fail("Sem permissão");
      if (encoding === "windows1252" && /[^\u0000-\u00ff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(contents)) fail("Caractere fora do Windows-1252 — salve em UTF-8");
      const written = writeNode(target, contents);
      written.encoding = encoding;
      written.eol = eol;
      log.writes.push({ path: target, content: eol === "crlf" ? contents.replace(/\n/g, "\r\n") : contents, encoding });
      return stamp(written);
    },
    stat: async (root, paths) =>
      paths.map((path) => {
        const node = fileNode(resolve(root, path));
        return node ? stamp(node) : null;
      }),
    create: async (root, path, dir) => {
      const target = resolve(root, path);
      if (nodes.has(lower(target))) fail("Já existe um item com esse nome");
      if (dir) ensureDir(target);
      else putFile(target, "");
      log.created.push(target);
      emit(target, "created");
    },
    rename: async (root, from, to) => {
      const source = resolve(root, from);
      const target = resolve(root, to);
      if (!nodes.has(lower(source))) fail("Arquivo não encontrado");
      if (nodes.has(lower(target)) && !samePath(source, target)) fail("Já existe um item com esse nome");
      if (isInside(source, target) && !samePath(source, target)) fail("Não dá para mover uma pasta para dentro dela mesma");
      for (const node of descendants(source)) {
        nodes.delete(lower(node.path));
        node.path = joinPath(target, relativePath(source, node.path) ?? "");
        nodes.set(lower(node.path), node);
      }
      log.renames.push([source, target]);
      emit(source, "removed");
      emit(target, "created");
    },
    copy: async (root, from, to) => {
      const source = fileNode(resolve(root, from)) ?? fail("Arquivo não encontrado");
      let target = resolve(root, to);
      for (let n = 2; nodes.has(lower(target)); n++) {
        const name = baseName(to);
        const dot = name.lastIndexOf(".");
        const next = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
        target = joinPath(dirName(resolve(root, to)), next);
      }
      putFile(target, { content: source.content, encoding: source.encoding, eol: source.eol });
      emit(target, "created");
      return relativePath(root, target)!;
    },
    remove: async (root, paths, permanent) => {
      for (const path of paths) {
        const target = resolve(root, path);
        if (!nodes.has(lower(target))) fail("Arquivo não encontrado");
        if (!permanent) log.trash.push(target);
        removeNode(target);
      }
    },
    reveal: async (root, path) => {
      log.revealed.push(resolve(root, path));
    },
    disk: async (root) => ({ name: driveOf(root) ?? "/", used: 475 * GB, total: 487 * GB }),
    files: async (root) => ({ files: searchFiles(root), truncated: false }),
    search: async (root, query, onEvent) => {
      const id = ++searchId;
      log.searches.push(query);
      const flags = query.caseSensitive ? "g" : "gi";
      let source = query.regex ? query.pattern : query.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (query.wholeWord) source = `\\b(?:${source})\\b`;
      let pattern: RegExp;
      try {
        pattern = new RegExp(source, flags);
      } catch {
        throw "Expressão regular inválida";
      }
      const includes = query.include.map(globToRegExp);
      const excludes = query.exclude.map(globToRegExp);
      const max = query.maxResults ?? 2000;
      const files = searchFiles(root).filter((rel) => (!includes.length || includes.some((rule) => rule.test(rel))) && !excludes.some((rule) => rule.test(rel)));
      const started = performance.now();
      let total = 0;
      let searched = 0;
      const step = (index: number) => {
        if (id !== searchId) {
          onEvent({ event: "done", id, files: searched, total, truncated: false, cancelled: true, millis: performance.now() - started });
          return;
        }
        if (index >= files.length || total >= max) {
          onEvent({ event: "done", id, files: searched, total, truncated: total >= max, cancelled: false, millis: performance.now() - started });
          return;
        }
        const node = fileNode(joinPath(root, files[index]))!;
        searched++;
        if (!node.binary && !node.tooLarge) {
          const matches: SearchMatch[] = [];
          node.content.split("\n").forEach((line, lineIndex) => {
            pattern.lastIndex = 0;
            for (let match = pattern.exec(line); match && total < max; match = pattern.exec(line)) {
              if (!match[0].length) {
                pattern.lastIndex++;
                continue;
              }
              const indent = line.length - line.trimStart().length;
              matches.push({ path: files[index], line: lineIndex + 1, column: match.index, length: match[0].length, preview: line.trimStart().slice(0, 200), previewColumn: match.index - indent });
              total++;
            }
          });
          if (matches.length) onEvent({ event: "matches", id, matches });
        }
        window.setTimeout(() => step(index + 1), 0);
      };
      window.setTimeout(() => step(0), 0);
      return id;
    },
    cancelSearch: async () => {
      searchId++;
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    git,
  };

  window.__JARVIS_FS_FAKE__ = {
    read: (path) => {
      const node = fileNode(path);
      return node ? node.content : null;
    },
    exists: (path) => nodes.has(lower(path)),
    external: {
      write: (path, content) => void writeNode(path, content),
      create: (path, content = "") => void writeNode(path, content),
      remove: (path) => removeNode(path),
    },
    picks,
    log,
    repo: (root) => {
      const repo = repoOf(root);
      if (!repo) return null;
      const status = statusOf(repo, root);
      return {
        branch: repo.branch,
        ahead: repo.ahead,
        behind: repo.behind,
        pushes: repo.pushes,
        commits: repo.commits.map((commit) => commit.subject),
        stashes: repo.stashes.length,
        staged: status.staged.map((item) => item.path),
      };
    },
  };

  return backend;
}

export type { SearchEvent };
