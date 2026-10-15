import { withErrorHandling } from "@/lib/api/http";
import { uuid } from "@/lib/dashboard/user-parse";
import { cancelScheduleRequest } from "@/lib/schedule/service";

// The bubble closed before Hermes answered. A request that already settled is returned as is.
export const POST = withErrorHandling(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  return Response.json(await cancelScheduleRequest(uuid((await context.params).id, "id")));
});
