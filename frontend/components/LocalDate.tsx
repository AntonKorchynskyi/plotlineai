"use client";

import { useSyncExternalStore } from "react";

const format = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });

const subscribe = () => () => {};

/**
 * A date in the reader's own time zone. The server only knows UTC, so a share made in the
 * evening in the Americas would read as the next day. The server renders the UTC date, and
 * hydration swaps in the local one: useSyncExternalStore re-renders with the client value
 * without a hydration mismatch.
 */
export default function LocalDate({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => format(iso),
    () => format(iso, "UTC"),
  );
  return <time dateTime={iso}>{text}</time>;
}
