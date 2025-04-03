import { RelayPool } from "applesauce-relay";
import {
  ReplaceableLoader,
  SingleEventLoader,
} from "applesauce-loaders/loaders";
import { Filter, NostrEvent } from "nostr-tools";
import { NostrRequest } from "applesauce-loaders";
import { EventStore } from "applesauce-core";
import { merge, Subscription } from "rxjs";

export default class NostrLoaders {
  protected request: NostrRequest = (relays: string[], filters: Filter[]) =>
    this.pool.req(relays, filters);

  replaceable = new ReplaceableLoader(this.request);
  single = new SingleEventLoader(this.request);

  cleanup: Subscription[] = [];
  constructor(
    public pool: RelayPool,
    public events: EventStore,
  ) {}

  start() {
    this.cleanup.push(
      merge<[NostrEvent, NostrEvent]>(this.replaceable, this.single).subscribe(
        (event) => this.events.add(event),
      ),
    );
  }

  stop() {
    this.cleanup.forEach((c) => c.unsubscribe());
    this.cleanup = [];
  }

  setLookupRelays(relays: string[]) {
    this.replaceable.lookupRelays = relays;
  }
}
