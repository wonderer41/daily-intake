import { withErrorHandling } from "@/lib/api/http";
import { uuid } from "@/lib/dashboard/user-parse";
import { getScheduleRequest } from "@/lib/schedule/service";

export const GET = withErrorHandling(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  return Response.json(await getScheduleRequest(uuid((await context.params).id, "id")));
});
