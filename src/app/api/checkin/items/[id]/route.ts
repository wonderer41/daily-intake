import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { boolean, ROOT, strictObject } from "@/lib/api/validate";
import { setCheckinItemDone } from "@/lib/dashboard/checkin";
import { uuid } from "@/lib/dashboard/user-parse";

// Checking a check-in line that is not one of the cards' checklist items ({ done }).
export const PATCH = withErrorHandling(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const id = uuid((await context.params).id, "id");
  const body = strictObject(await readJsonBody(request), ROOT, ["done"]);
  return Response.json(await setCheckinItemDone(id, boolean(body.done, "done")));
});
