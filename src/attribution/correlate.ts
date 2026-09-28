import type { CorrelationStatus } from "../domain/types.js";

export const EXACT_WINDOW_MS = 30_000;
export const INFERRED_WINDOW_MS = 2 * 60 * 60 * 1000;

export type TimedCandidate = {
  id: string;
  userEmail: string | null;
  conversationId: string | null;
  timestamp: number | null;
};

export type CorrelationResult =
  | { status: "exact"; matchId: string }
  | { status: "inferred"; matchId: string }
  | { status: "unmatched" }
  | { status: "ambiguous"; candidateIds: string[] };

function sameUser(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

function sameConversation(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left === right;
}

function within(a: number | null, b: number | null, windowMs: number): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= windowMs;
}

export function correlateEvent(
  source: TimedCandidate,
  candidates: TimedCandidate[],
): CorrelationResult {
  const eligible = candidates.filter(
    (candidate) =>
      sameUser(source.userEmail, candidate.userEmail) &&
      sameConversation(source.conversationId, candidate.conversationId),
  );

  if (eligible.length === 0) return { status: "unmatched" };

  const exactHits = eligible.filter((candidate) =>
    within(source.timestamp, candidate.timestamp, EXACT_WINDOW_MS),
  );
  if (exactHits.length === 1) {
    return { status: "exact", matchId: exactHits[0]!.id };
  }
  if (exactHits.length > 1) {
    return { status: "ambiguous", candidateIds: exactHits.map((hit) => hit.id) };
  }

  const inferredHits = eligible.filter((candidate) =>
    within(source.timestamp, candidate.timestamp, INFERRED_WINDOW_MS),
  );
  if (inferredHits.length === 1) {
    return { status: "inferred", matchId: inferredHits[0]!.id };
  }
  if (inferredHits.length > 1) {
    return { status: "ambiguous", candidateIds: inferredHits.map((hit) => hit.id) };
  }

  return { status: "unmatched" };
}

export function isJoinable(status: CorrelationStatus): boolean {
  return status === "exact" || status === "inferred";
}
