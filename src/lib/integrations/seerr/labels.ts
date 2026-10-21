import type { SeerrRequestDto } from "@/types/dashboard-contracts";

// Seerr request labels shared by the Notes panel and the Important entries the Seerr poll raises.

/** "season 1", "seasons 1–3", "seasons 1–2, 5"; Seerr's season 0 is Specials. Null for movies / no seasons. */
export function seasonsLabel(seasons: readonly number[] | null): string | null {
  if (!seasons || seasons.length === 0) return null;
  const sorted = [...new Set(seasons)].sort((a, b) => a - b);
  const specials = sorted[0] === 0;
  const numbered = specials ? sorted.slice(1) : sorted;
  const ranges: string[] = [];
  for (let i = 0; i < numbered.length; ) {
    let j = i;
    while (j + 1 < numbered.length && numbered[j + 1] === numbered[j] + 1) j += 1;
    ranges.push(i === j ? `${numbered[i]}` : `${numbered[i]}–${numbered[j]}`);
    i = j + 1;
  }
  const parts: string[] = [];
  if (specials) parts.push("specials");
  if (numbered.length > 0) parts.push(`${numbered.length === 1 ? "season" : "seasons"} ${ranges.join(", ")}`);
  return parts.join(" + ");
}

/** "The Matrix (1999)". */
export function requestTitle(request: Pick<SeerrRequestDto, "title" | "year">): string {
  return request.year === null ? request.title : `${request.title} (${request.year})`;
}
