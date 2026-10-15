// What Hermes says in the scheduling bubble when the server, not the page, settles a request.
// The bubble's own checks reuse the shared ones so both sides read the same.

export const SCHEDULE_MESSAGES = {
  pastDay: "That day is over. Pick a time today or later.",
  pastMidnight: "That runs past midnight. Try an earlier start.",
  noAnswer: "Hermes didn't answer. Try again.",
  notConfigured: "I'm not connected to the dashboard yet. Set HERMES_API_URL and HERMES_API_KEY on the server.",
  busy: "I'm busy with other work right now. Try again in a minute.",
  unreadable: "I checked, but my answer came out garbled. Try again.",
} as const;

export function pastTimeMessage(nowClock: string): string {
  return `That time already passed today. Pick something after ${nowClock}.`;
}

/** Hermes's own reason, kept short enough for the bubble. */
export function couldNotBookMessage(reason: string): string {
  const text = reason.replace(/\s+/g, " ").trim().slice(0, 200);
  return text ? `I couldn't book it: ${text}` : SCHEDULE_MESSAGES.noAnswer;
}
