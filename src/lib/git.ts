import { invoke } from "@tauri-apps/api/core";

/** Mirrors src-tauri/src/git: the repository as the git CLI reports it. Paths are relative to the repo root, with "/". */

export interface GitChange {
  path: string;
  /** Renames and copies: where it came from. */
  origPath: string | null;
  /** One letter: M A D R C T U ?. */
  status: string;
  submodule: boolean;
}

export interface GitStatus {
  /** Absolute. */
  repoRoot: string;
  /** The opened folder inside the repo ("" when it is the repo root), with "/". */
  prefix: string;
  branch: string | null;
  /** Short commit id; null before the first commit. */
  head: string | null;
  detached: boolean;
  initial: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  stash: number;
  staged: GitChange[];
  unstaged: GitChange[];
  untracked: GitChange[];
  conflicted: GitChange[];
  operation: "merge" | "rebase" | "cherry-pick" | "revert" | null;
  truncated: boolean;
}

export interface Commit {
  hash: string;
  short: string;
  author: string;
  email: string;
  /** Unix seconds. */
  time: number;
  refs: string;
  subject: string;
}

export interface Diff {
  text: string;
  binary: boolean;
  truncated: boolean;
}

export interface Stash {
  index: number;
  time: number;
  message: string;
}

export interface Branch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
}

/** `root` is the opened folder; the backend finds the repository above it. */
export interface GitBackend {
  status(root: string): Promise<GitStatus | null>;
  stage(root: string, paths: string[]): Promise<void>;
  unstage(root: string, paths: string[]): Promise<void>;
  /** Tracked files go back to the index; untracked ones go to the Recycle Bin. */
  discard(root: string, paths: string[]): Promise<void>;
  stageAll(root: string): Promise<void>;
  unstageAll(root: string): Promise<void>;
  discardAll(root: string, untracked: boolean): Promise<void>;
  /** The new commit's short id. */
  commit(root: string, message: string, amend: boolean): Promise<string>;
  push(root: string): Promise<string>;
  pull(root: string): Promise<string>;
  fetch(root: string): Promise<string>;
  log(root: string, limit: number, skip: number): Promise<Commit[]>;
  diff(root: string, path: string, staged: boolean): Promise<Diff>;
  showFile(root: string, path: string, rev: "HEAD" | "INDEX"): Promise<string | null>;
  stashList(root: string): Promise<Stash[]>;
  stashPush(root: string, message: string | null, untracked: boolean): Promise<void>;
  stashPop(root: string, index: number): Promise<void>;
  stashDrop(root: string, index: number): Promise<void>;
  branches(root: string): Promise<Branch[]>;
  checkout(root: string, branch: string, create: boolean): Promise<void>;
}

export const tauriGit: GitBackend = {
  status: (root) => invoke("git_status", { root }),
  stage: (root, paths) => invoke("git_stage", { root, paths }),
  unstage: (root, paths) => invoke("git_unstage", { root, paths }),
  discard: (root, paths) => invoke("git_discard", { root, paths }),
  stageAll: (root) => invoke("git_stage_all", { root }),
  unstageAll: (root) => invoke("git_unstage_all", { root }),
  discardAll: (root, untracked) => invoke("git_discard_all", { root, untracked }),
  commit: (root, message, amend) => invoke("git_commit", { root, message, amend }),
  push: (root) => invoke("git_push", { root }),
  pull: (root) => invoke("git_pull", { root }),
  fetch: (root) => invoke("git_fetch", { root }),
  log: (root, limit, skip) => invoke("git_log", { root, limit, skip }),
  diff: (root, path, staged) => invoke("git_diff", { root, path, staged }),
  showFile: (root, path, rev) => invoke("git_show_file", { root, path, rev }),
  stashList: (root) => invoke("git_stash_list", { root }),
  stashPush: (root, message, untracked) => invoke("git_stash_push", { root, message, untracked }),
  stashPop: (root, index) => invoke("git_stash_pop", { root, index }),
  stashDrop: (root, index) => invoke("git_stash_drop", { root, index }),
  branches: (root) => invoke("git_branches", { root }),
  checkout: (root, branch, create) => invoke("git_checkout", { root, branch, create }),
};
