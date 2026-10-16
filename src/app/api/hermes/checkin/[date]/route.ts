import { invalid } from "@/lib/api/validate";
import { readJsonBody } from "@/lib/api/http";
import { upsertCheckin } from "@/lib/dashboard/checkin";
import { withHermesAuth } from "@/lib/hermes/auth";
import { parseUpsertCheckin } from "@/lib/hermes/parse";
import { isDateString } from "@/lib/time/zone";

// The weekly check-in for the week :date falls in (any day of it; it is stored under that week's Monday).
export const PUT = withHermesAuth(async (request: Request, context: { params: Promise<{ date: string }> }) => {
  const date = (await context.params).date;
  if (!isDateString(date)) invalid("date", "must be a YYYY-MM-DD calendar date");
  const result = await upsertCheckin(date, parseUpsertCheckin(await readJsonBody(request)));
  return Response.json(result, { status: result.created ? 201 : 200 });
});
