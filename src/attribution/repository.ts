import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { UNALLOCATED, exact, type Dimension } from "../domain/types.js";

export type RepoLookup = (root: string) => string | null;

export function gitRemoteAt(root: string): string | null {
  if (!fs.existsSync(root)) return null;
  const result = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    const url = result.stdout.trim();
    if (url) return url;
  }
  const gitDir = path.join(root, ".git");
  if (fs.existsSync(gitDir)) return root;
  return root;
}

function rootContaining(roots: string[], fileOrCwd: string | null | undefined): string | null {
  if (!fileOrCwd) return null;
  const normalised = path.resolve(fileOrCwd);
  const matches = roots.filter((root) => {
    const resolved = path.resolve(root);
    return normalised === resolved || normalised.startsWith(resolved + path.sep);
  });
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    matches.sort((a, b) => b.length - a.length);
    const longest = matches[0]!;
    const second = matches[1]!;
    if (longest.length > second.length) return longest;
    return null;
  }
  return null;
}

export function resolveRepository(
  workspaceRoots: string[],
  options: { cwd?: string | null; filePath?: string | null; lookup?: RepoLookup } = {},
): Dimension<string> {
  const roots = workspaceRoots.filter(Boolean);
  const lookup = options.lookup ?? gitRemoteAt;

  const identified = rootContaining(roots, options.filePath) ?? rootContaining(roots, options.cwd);

  if (identified) {
    return exact(lookup(identified) ?? identified);
  }

  if (roots.length === 1) {
    const only = roots[0]!;
    return exact(lookup(only) ?? only);
  }

  return UNALLOCATED();
}
