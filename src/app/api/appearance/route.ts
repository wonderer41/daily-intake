import { readJsonBody, withErrorHandling } from "@/lib/api/http";
import { getAppearance, parseAppearanceBody, setAppearance } from "@/lib/appearance/store";

// The page's theme and background, the same on every device. The header's Appearance panel
// writes it; Hermes can change it too (PUT /api/hermes/appearance).
export const GET = withErrorHandling(async () => Response.json(await getAppearance()));

export const PUT = withErrorHandling(async (request: Request) => {
  const { data } = await setAppearance(parseAppearanceBody(await readJsonBody(request)), "user");
  return Response.json(data);
});
