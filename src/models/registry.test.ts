import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client.js";
import { diffAgainstPrevious, observeModel, snapshotRegistry } from "./registry.js";

describe("model registry", () => {
  it("alerts when an identifier appears that was absent from the previous snapshot", () => {
    const db = openMemoryDb();
    observeModel(db, "composer-2.5", 1);
    snapshotRegistry(db, "observed", [{ id: "composer-2.5", source: "observed" }]);
    observeModel(db, "claude-4.5-sonnet", 2);
    const alerts = diffAgainstPrevious(db, "observed", [
      { id: "composer-2.5", source: "observed" },
      { id: "claude-4.5-sonnet", source: "observed" },
    ]);
    expect(alerts).toEqual([
      expect.objectContaining({
        kind: "new_model",
        modelId: "claude-4.5-sonnet",
      }),
    ]);
    expect(alerts[0]?.summary).toContain("previous observed snapshot");
  });

  it("does not treat first snapshot as a new-model launch", () => {
    const db = openMemoryDb();
    const alerts = diffAgainstPrevious(db, "observed", [{ id: "composer-2.5", source: "observed" }]);
    expect(alerts).toEqual([]);
  });
});
