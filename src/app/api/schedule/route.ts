import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { parseScheduleBody } from "@/lib/schedule/request";
import { createScheduleRequest } from "@/lib/schedule/service";

// "Ask Hermes" in the scheduling bubble. Answers right away: 202 while Hermes works on it (progress
// arrives as schedule.updated), 200 when the server settled it already (a clash or a bad time).
export const POST = withErrorHandling(async (request: Request) => {
  const dto = await createScheduleRequest(parseScheduleBody(await readJsonBody(request)));
  return Response.json(dto, { status: dto.status === "checking" ? 202 : 200 });
});
