import { readJsonBody } from "@/lib/api/http";
import { withHermesAuth } from "@/lib/hermes/auth";
import { getCalendarSources, setCalendarSources } from "@/lib/hermes/calendar-sources";
import { parseCalendarSources } from "@/lib/hermes/parse";

// D4: which Google calendars the timeline shows. GET lists every calendar on the account.
export const GET = withHermesAuth(async () => Response.json({ data: await getCalendarSources() }));

// Replaces the extra calendars (the booking calendar is always shown); added ones are synced before the response.
export const PUT = withHermesAuth(async (request: Request) => {
  const { calendarIds } = parseCalendarSources(await readJsonBody(request));
  return Response.json(await setCalendarSources(calendarIds));
});
