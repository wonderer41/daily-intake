import { withErrorHandling } from "@/lib/api/http";
import { dismissAlert } from "@/lib/dashboard/alerts";
import { uuid } from "@/lib/dashboard/user-parse";
import { parseNoInput, readOptionalJsonBody } from "@/lib/hermes/parse";

type RouteContext = { params: Promise<{ id: string }> };

// Gerardo hides an alert in Important until it reopens or turns critical. Returns the AlertDto.
export const POST = withErrorHandling(async (request: Request, { params }: RouteContext) => {
  const id = uuid((await params).id, "id");
  parseNoInput(await readOptionalJsonBody(request));
  return Response.json(await dismissAlert(id));
});
