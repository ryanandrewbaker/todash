import { deriveFromBilling, insertBillingObservation } from "../../attribution/index.js";
import type { Db } from "../../db/client.js";
import { fetchUsageEvents, parseBillingEvent, type AdminApiConfig } from "./client.js";

export function ingestBillingPayload(db: Db, raw: Record<string, unknown>): string {
  const observation = parseBillingEvent(raw);
  const id = insertBillingObservation(db, {
    event_timestamp: observation.timestamp ?? null,
    user_email: observation.userEmail ?? null,
    conversation_id: observation.conversationId ?? null,
    executed_model: observation.executedModel ?? null,
    kind: observation.kind ?? null,
    is_chargeable: observation.isChargeable == null ? null : observation.isChargeable ? 1 : 0,
    charged_cents: observation.chargedCents ?? null,
    attributed_cents: observation.attributedCents ?? null,
    cursor_token_fee: observation.cursorTokenFee ?? null,
    payload: raw,
  });
  deriveFromBilling(db, id);
  return id;
}

export async function pollBilling(
  db: Db,
  config: AdminApiConfig,
  range: { startDate: number; endDate: number },
): Promise<number> {
  let page = 1;
  let ingested = 0;
  for (;;) {
    const events = await fetchUsageEvents(config, { ...range, page, pageSize: 1000 });
    if (events.length === 0) break;
    for (const event of events) {
      ingestBillingPayload(db, event);
      ingested += 1;
    }
    if (events.length < 1000) break;
    page += 1;
  }
  return ingested;
}
