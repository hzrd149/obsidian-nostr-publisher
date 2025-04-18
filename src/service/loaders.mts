import { merge, Subscription } from "rxjs";
import { RelayPool } from "applesauce-relay";
import {
  ReplaceableLoader,
  SingleEventLoader,
  NostrRequest,
} from "applesauce-loaders";
import { Filter } from "nostr-tools";
import { EventStore } from "applesauce-core";

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
      merge(this.replaceable.observable, this.single.observable).subscribe(
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
