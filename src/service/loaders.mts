import { merge, Observable, Subscription } from "rxjs";
import { RelayPool } from "applesauce-relay";
import {
  AddressPointerLoader,
  createAddressLoader,
  createEventLoader,
  EventPointerLoader,
} from "applesauce-loaders/loaders";
import { Filter } from "nostr-tools";
import { EventStore } from "applesauce-core";

export default class NostrLoaders {
  address: AddressPointerLoader;
  event: EventPointerLoader;

  cleanup: Subscription[] = [];
  constructor(
    public pool: RelayPool,
    public eventStore: EventStore,
    public lookupRelays: string[] | Observable<string[]>,
  ) {
    this.address = createAddressLoader(this.pool, { eventStore, lookupRelays });
    this.event = createEventLoader(this.pool, { eventStore });
  }
}
