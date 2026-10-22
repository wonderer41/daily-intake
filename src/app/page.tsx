import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DatabaseDown } from "@/components/database-down";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getToday } from "@/lib/dashboard/today";
import { databaseReachable } from "@/lib/db/ping";
import { dashboardTimeZone, formatDayHeading, isDateString, localDateString, zonedTimeToUtc } from "@/lib/time/zone";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  // The date changes every day, so render per request.
  await connection();
  const param = (await searchParams).date;
  const requested = Array.isArray(param) ? param[0] : param;
  // Same rule as GET /api/today; a bad ?date= goes back to today with a clean URL.
  if (requested !== undefined && !isDateString(requested)) redirect("/");

  const now = new Date();
  const timeZone = dashboardTimeZone();
  const date = requested ?? localDateString(now, timeZone);
  // A database outage gets its own page that reloads itself once the database is back;
  // any other failure is rethrown to src/app/error.tsx.
  const today = await getToday(date, now).catch(async (error: unknown) => {
    if (await databaseReachable("page")) throw error;
    return null;
  });
  if (!today) {
    const heading = formatDayHeading(zonedTimeToUtc(date, 12 * 60, timeZone), timeZone);
    return <DatabaseDown weekday={heading.weekday} monthDay={heading.monthDay} timeZone={timeZone} checkedAt={now.toISOString()} />;
  }

  // Keyed by the URL's date: navigating between ?date= and today remounts the client tree with fresh state.
  return <Dashboard key={requested ?? "today"} initial={today} pinned={requested !== undefined} />;
}
