import { readJsonBody } from "@/lib/api/http";
import { getAppearance, parseAppearanceBody, setAppearance } from "@/lib/appearance/store";
import { withHermesAuth } from "@/lib/hermes/auth";

// The page's theme and background, when the user asks Hermes to change the look.
export const GET = withHermesAuth(async () => Response.json({ data: await getAppearance() }));

// `theme`, `background` or both; sending the current look again changes nothing.
export const PUT = withHermesAuth(async (request: Request) => {
  return Response.json(await setAppearance(parseAppearanceBody(await readJsonBody(request)), "hermes"));
});
