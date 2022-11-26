// This must come first because of dependencies on mocks which must be loaded
// before trying to load the "live" code.
import {tests} from "./index.test";

import FakeTimers from "@sinonjs/fake-timers";
import {expect} from "chai";

import * as events from "../../mock/events";
import {NanoDisconnectedError} from "../../util/nanoservice";
import Client from "./client";
import type * as Proto from "./proto";

async function kvs_factory(): Promise<Client<string, string>> {
  return new Client("kvs-test", () => new MockServicePort());
}

describe("datastore/kvs/client", function () {
  describe("implements KeyValueStore", () => tests(kvs_factory));

  let clock: FakeTimers.InstalledClock | undefined;
  let kvs: Client<string, string>;
  let port: MockServicePort;

  beforeEach(async () => {
    kvs = await kvs_factory();
    port = (<any>kvs)._port;
  });

  afterEach(() => {
    if (clock) clock.uninstall();
    clock = undefined;
  });

  it("notifies users and tries to reconnect when sync is lost", async () => {
    await kvs.set([{key: "a", value: "b"}]);
    await events.next(kvs.onSet);
    expect(await kvs.get(["a"])).to.deep.equal([{key: "a", value: "b"}]);
    expect(port.entries.get("a")).to.deep.equal("b");

    port.disconnect();
    await events.next(kvs.onSyncLost);

    // After the disconnection, KVSClient should try to reconnect using the
    // factory, which results in a new MockServicePort being created.
    expect((<any>kvs)._port).not.to.equal(port);
    expect(await kvs.get(["a"])).to.deep.equal([]);
  });

  it("retries requests dropped due to disconnection", async () => {
    port.inject = async msg => {
      port.disconnect();
      throw new NanoDisconnectedError(port.name, "");
    };

    const p = kvs.set([{key: "a", value: "b"}]);
    await events.next(kvs.onSyncLost);
    port.inject = undefined;
    await p;
    await events.next(kvs.onSet);

    expect((<any>kvs)._port).not.to.equal(port);
    expect(await kvs.get(["a"])).to.deep.equal([{key: "a", value: "b"}]);
  });

  it("eventually stops retrying given enough failures", async () => {
    clock = FakeTimers.install();
    const inject = async () => {
      (<any>kvs)._port.disconnect();
      throw new NanoDisconnectedError(port.name, "");
    };
    (<any>kvs)._port.inject = inject;

    const p = kvs.set([{key: "a", value: "b"}]);
    for (let i = 0; i < 11; ++i) {
      clock.runAll();
      await events.next(kvs.onSyncLost);
      (<any>kvs)._port.inject = inject;
    }
    try {
      await p;
      // istanbul ignore next
      expect(true).to.be.false;
    } catch (e) {
      expect(e).to.be.instanceOf(NanoDisconnectedError);
    }

    expect((<any>kvs)._port).not.to.equal(port);
  });

  it("propagates actual nanoservice errors to the caller", async () => {
    const sym = Symbol("error");
    port.inject = () => {
      throw sym;
    };
    try {
      await kvs.set([{key: "a", value: "b"}]);
      // istanbul ignore next
      expect(true).to.be.false;
    } catch (e) {
      expect(e).to.equal(sym);
    }
  });
});

// XXX Refactor me into something that just composes MemoryKVS (which was added
// after this code was written) with something that responds to KVS service
// messages.  Or to put it another way, split kvs/service.ts into the IndexedDB
// KVS and the thing that forwards messages/events to/from IndexedDB KVS.
class MockServicePort implements Proto.ServicePort<string, string> {
  readonly name: string = "";

  // istanbul ignore next
  onNotify = (_: Proto.ServiceMsg<string, string>) => undefined;
  onDisconnect?: (port: Proto.ServicePort<string, string>) => void = undefined;

  entries = new Map<string, string>();

  inject?: (
    msg: Proto.ClientMsg<string, string>,
  ) => Promise<Proto.ServiceMsg<string, string>>;

  async request(
    msg: Proto.ClientMsg<string, string>,
  ): Promise<Proto.ServiceMsg<string, string>> {
    // istanbul ignore next
    if (!msg) return null;

    if (this.inject) return await this.inject(msg);

    switch (msg.$type) {
      case "get":
        const entries: Proto.Entry<string, string>[] = [];
        for (const key of msg.keys) {
          const v = this.entries.get(key);
          if (v) entries.push({key, value: copy(v)});
        }
        return {$type: "entries", entries};

      case "getStartingFrom":
        let keys = Array.from(this.entries.keys()).sort();
        if (msg.bound !== undefined) keys = keys.filter(x => x > msg.bound!);
        return {
          $type: "entries",
          entries: keys
            .slice(0, msg.limit)
            .map(key => ({key, value: copy(this.entries.get(key))})),
        };

      case "getEndingAt":
        let rkeys = Array.from(this.entries.keys()).sort().reverse();
        if (msg.bound !== undefined) rkeys = rkeys.filter(x => x < msg.bound!);
        return {
          $type: "entries",
          entries: rkeys
            .slice(0, msg.limit)
            .map(key => ({key, value: copy(this.entries.get(key))})),
        };

      case "set":
        for (const {key, value} of msg.entries) {
          if (value !== undefined) this.entries.set(key, value);
          else this.entries.delete(key);
        }
        const res = {
          $type: "set",
          entries: copy(msg.entries),
        } as const;
        if (res.entries.length > 0) this.onNotify(res);
        return null;

      case "deleteAll":
        const all_deleted = [];
        for (const k of this.entries.keys()) {
          this.entries.delete(k);
          all_deleted.push({key: k});
        }
        this.onNotify({$type: "set", entries: all_deleted});
        return null;
    }
  }

  // istanbul ignore next
  notify(msg: Proto.ClientMsg<string, string>) {}

  // istanbul ignore next
  disconnect() {
    this.onDisconnect && this.onDisconnect(this);
  }
}

const copy = (x: any) => JSON.parse(JSON.stringify(x));
