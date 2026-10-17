import { GitHubMark } from "@/components/ui/github-mark";
import { HermesLogo } from "@/components/ui/hermes-logo";
import { PersonIcon } from "@/components/ui/icons";
import type { ChecklistItemDto } from "@/types/dashboard-contracts";
import { shortSha } from "./labels";

const BOX = "flex size-11 shrink-0 items-center justify-center text-text-muted";

/**
 * Who checked a done item, as a 20px mark: a person (you), the Hermes logo, or the GitHub mark when
 * you confirmed a Hermes push update (it links that push). Nothing for open items or unknown ones.
 */
export function DoneBy({ item }: { item: Pick<ChecklistItemDto, "done" | "doneBy" | "donePush"> }) {
  if (!item.done || !item.doneBy) return null;

  if (item.doneBy === "push") {
    if (!item.donePush) return null;
    const sha = shortSha(item.donePush.commitSha);
    return (
      <a
        href={item.donePush.commitUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Checked from push ${sha}`}
        className={`${BOX} hover:text-text-strong`}
      >
        <GitHubMark size={20} />
        <span className="sr-only">Checked from push {sha} (opens GitHub in a new tab)</span>
      </a>
    );
  }

  const name = item.doneBy === "user" ? "you" : "Hermes";
  return (
    <span className={BOX} title={`Checked by ${name}`}>
      {item.doneBy === "user" ? <PersonIcon size={20} /> : <HermesLogo size={20} />}
      <span className="sr-only">Checked by {name}</span>
    </span>
  );
}
