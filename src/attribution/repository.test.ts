import { describe, expect, it } from "vitest";
import { resolveRepository } from "./repository.js";

const lookup = (root: string) => `repo:${root}`;

describe("repository resolution", () => {
  it("is exact for a single workspace root", () => {
    const result = resolveRepository(["/work/customer-api"], { lookup });
    expect(result).toEqual({ value: "repo:/work/customer-api", confidence: "exact" });
  });

  it("stays unallocated when multiple roots are present and none is identified", () => {
    const result = resolveRepository(["/work/repo-a", "/work/repo-b", "/work/repo-c"], { lookup });
    expect(result).toEqual({ value: null, confidence: "unallocated" });
  });

  it("is exact when cwd sits under exactly one root", () => {
    const result = resolveRepository(["/work/repo-a", "/work/repo-b"], {
      cwd: "/work/repo-b/src/index.ts",
      lookup,
    });
    expect(result).toEqual({ value: "repo:/work/repo-b", confidence: "exact" });
  });

  it("does not copy activity onto every candidate root", () => {
    const result = resolveRepository(["/a", "/b"], { lookup });
    expect(result.value).toBeNull();
  });
});
