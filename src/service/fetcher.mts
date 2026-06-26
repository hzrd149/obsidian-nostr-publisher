import { RelayGroup } from "applesauce-relay";
import { lastValueFrom, takeUntil, timer, toArray } from "rxjs";
import { Filter } from "nostr-tools";

/**
 * Fetch the latest events that match the filter from the given relays
 * @param relays The relays to fetch from
 * @param filters The nostr filters to fetch events by
 * @param timeout The timeout for the fetch
 * @returns An array of events
 */
export function fetchLatestEvents(
  group: RelayGroup,
  filters: Filter,
  timeout = 10_000,
) {
  // Wait for the observable to complete
  return lastValueFrom(
    // Request events from the relay group. `request` emits NostrEvents and
    // completes on its own (first relay EOSE + grace period, or all EOSE).
    group.request(filters).pipe(
      // Hard timeout after 10 seconds
      takeUntil(timer(timeout)),
      // Collect all events into an array
      toArray(),
    ),
  );
}
