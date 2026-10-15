import { readJsonBody } from "@/lib/api/http";
import { deleteWaitingItem, upsertWaitingItem } from "@/lib/dashboard/waiting";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseDedupeKeyParam } from "@/lib/hermes/keys";
import { parseUpsertWaitingItem } from "@/lib/hermes/parse";

// Custom "Waiting on you" items. The key uses the alert format, <source>:<thing>.
export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ key: string }> }) => {
  const key = parseDedupeKeyParam((await context.params).key, "key");
  const result = await upsertWaitingItem(key, parseUpsertWaitingItem(await readJsonBody(request)));
  return Response.json(result, { status: result.created ? 201 : 200 });
});

export const DELETE = withHermesAuth(async (_request: Request, context: { params: Promise<{ key: string }> }) => {
  return Response.json(await deleteWaitingItem(parseDedupeKeyParam((await context.params).key, "key")));
});
