import { describe, expect, it } from "vitest";
import { correlateEvent } from "./correlate.js";

const source = {
  id: "bill-1",
  userEmail: "ryan@example.com",
  conversationId: "conv-1",
  timestamp: 1_000_000,
};

describe("correlation", () => {
  it("is unmatched when no counterpart exists", () => {
    expect(correlateEvent(source, [])).toEqual({ status: "unmatched" });
  });

  it("is exact when a single candidate shares user, conversation and a tight timestamp", () => {
    const result = correlateEvent(source, [
      {
        id: "hook-1",
        userEmail: "ryan@example.com",
        conversationId: "conv-1",
        timestamp: 1_010_000,
      },
    ]);
    expect(result).toEqual({ status: "exact", matchId: "hook-1" });
  });

  it("is inferred when the only candidate is inside the wider window", () => {
    const result = correlateEvent(source, [
      {
        id: "hook-1",
        userEmail: "ryan@example.com",
        conversationId: "conv-1",
        timestamp: 1_000_000 + 10 * 60 * 1000,
      },
    ]);
    expect(result).toEqual({ status: "inferred", matchId: "hook-1" });
  });

  it("is ambiguous when two generations in the same conversation could match", () => {
    const result = correlateEvent(source, [
      {
        id: "hook-1",
        userEmail: "ryan@example.com",
        conversationId: "conv-1",
        timestamp: 1_005_000,
      },
      {
        id: "hook-2",
        userEmail: "ryan@example.com",
        conversationId: "conv-1",
        timestamp: 995_000,
      },
    ]);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidateIds.sort()).toEqual(["hook-1", "hook-2"]);
    }
  });

  it("does not join different conversations", () => {
    const result = correlateEvent(source, [
      {
        id: "hook-other",
        userEmail: "ryan@example.com",
        conversationId: "conv-2",
        timestamp: 1_000_000,
      },
    ]);
    expect(result).toEqual({ status: "unmatched" });
  });
});
