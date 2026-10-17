import type { AlertDto, NotesDto, TodayResponse, WorkCardDto } from "@/types/dashboard-contracts";
import { importantGroups } from "./warnings-rail/format";
import { ImportantPanel } from "./warnings-rail/important-panel";
import { NotesPanel } from "./warnings-rail/notes-panel";

export interface WarningsRailProps {
  /** Open alerts that weren't dismissed, oldest first. */
  alerts: AlertDto[];
  /** Working-on cards: their items' pending push updates show in Important too. */
  cards: WorkCardDto[];
  notes: NotesDto;
  /** Integration health; the rail uses `sources.seerr` (<SourceDown name="Seerr" verb="checked" …>). */
  sources: TodayResponse["sources"];
}

/**
 * Warnings (1/3 column): the amber Important panel (alerts and push updates to act on or dismiss;
 * hidden when empty) and Notes (Seerr, then Gerardo's and Hermes's notes).
 */
export function WarningsRail({ alerts, cards, notes, sources }: WarningsRailProps) {
  const groups = importantGroups(alerts, cards);
  return (
    <aside aria-label="Warnings" className="flex flex-col gap-6 text-[15px] leading-normal">
      {groups.length > 0 ? <ImportantPanel groups={groups} /> : null}
      <NotesPanel notes={notes} seerr={sources.seerr} />
    </aside>
  );
}
