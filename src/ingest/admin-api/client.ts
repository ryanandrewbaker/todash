import type { BillingObservation } from "../../domain/types.js";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

export function parseBillingEvent(raw: Record<string, unknown>): BillingObservation {
  const tokenUsage =
    raw.tokenUsage && typeof raw.tokenUsage === "object"
      ? (raw.tokenUsage as Record<string, unknown>)
      : {};
  return {
    timestamp: asNumber(raw.timestamp),
    userEmail: asString(raw.userEmail) ?? asString(raw.user_email) ?? asString(raw.email),
    conversationId: asString(raw.conversationId) ?? asString(raw.conversation_id),
    executedModel: asString(raw.model),
    kind: asString(raw.kind),
    isChargeable: asBoolean(raw.isChargeable) ?? asBoolean(raw.is_chargeable),
    chargedCents: asNumber(raw.chargedCents) ?? asNumber(raw.charged_cents),
    attributedCents: asNumber(tokenUsage.totalCents) ?? asNumber(tokenUsage.total_cents),
    cursorTokenFee: asNumber(raw.cursorTokenFee) ?? asNumber(raw.cursor_token_fee),
    payload: raw,
  };
}

export type AdminApiConfig = {
  apiKey: string;
  baseUrl?: string;
};

export async function fetchUsageEvents(
  config: AdminApiConfig,
  range: { startDate: number; endDate: number; page?: number; pageSize?: number },
): Promise<Record<string, unknown>[]> {
  const url = `${config.baseUrl ?? "https://api.cursor.com"}/teams/filtered-usage-events`;
  const auth = Buffer.from(`${config.apiKey}:`).toString("base64");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: range.startDate,
      endDate: range.endDate,
      page: range.page ?? 1,
      pageSize: range.pageSize ?? 1000,
    }),
  });
  if (!response.ok) {
    throw new Error(`Cursor Admin API ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { usageEvents?: Record<string, unknown>[] };
  return body.usageEvents ?? [];
}

export async function fetchModelCatalog(
  config: AdminApiConfig,
): Promise<{ available: boolean; payload: Record<string, unknown> | null; status?: number }> {
  const url = `${config.baseUrl ?? "https://api.cursor.com"}/teams/model-access/providers`;
  const auth = Buffer.from(`${config.apiKey}:`).toString("base64");
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (response.status === 409) {
    return { available: false, payload: null, status: 409 };
  }
  if (!response.ok) {
    throw new Error(`Cursor model catalog ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return { available: true, payload };
}
