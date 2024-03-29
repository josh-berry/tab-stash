import {expect} from "chai";
import {openDB} from "idb";

import * as events from "../../mock/events";
import * as NS from "../../util/nanoservice";
import Service from "./service";

import {tests} from "./index.test";
import type * as P from "./proto";

async function kvs_factory(): Promise<Service<string, string>> {
  NS.registry.reset_testonly();
  const db = await openDB("test", 1, {
    upgrade(db, oldVersion, newVersion, txn) {
      db.createObjectStore("test");
    },
  });
  return new Service(db, "test");
}

describe("datastore/kvs/service", function () {
  describe("implements KeyValueStore", () => tests(kvs_factory));

  describe("broadcasts object updates to clients", async () => {
    let client: MockPort;
    let svc: Service<string, string>;

    beforeEach(async () => {
      client = new MockPort();
      svc = await kvs_factory();
      svc.onConnect(client);
    });

    it("sends updates for new objects", async () => {
      await svc.set([{key: "a", value: "b"}]);
      await events.next(svc.onSet);

      expect(client.received).to.deep.equal([
        {$type: "set", entries: [{key: "a", value: "b"}]},
      ]);
    });

    it("sends updates for multiple new objects at once", async () => {
      await svc.set([
        {key: "a", value: "b"},
        {key: "b", value: "c"},
      ]);
      await events.next(svc.onSet);

      expect(client.received).to.deep.equal([
        {
          $type: "set",
          entries: [
            {key: "a", value: "b"},
            {key: "b", value: "c"},
          ],
        },
      ]);
    });

    it("sends updates for changed objects", async () => {
      await svc.set([{key: "a", value: "a"}]);
      await svc.set([{key: "a", value: "alison"}]);
      await events.nextN(svc.onSet, 2);

      expect(client.received).to.deep.equal([
        {$type: "set", entries: [{key: "a", value: "a"}]},
        {$type: "set", entries: [{key: "a", value: "alison"}]},
      ]);
    });

    it("sends updates for deleted objects", async () => {
      await svc.set([{key: "a", value: "a"}]);
      await events.next(svc.onSet);

      await svc.set([{key: "a"}]);
      await events.next(svc.onSet);

      expect(client.received).to.deep.equal([
        {$type: "set", entries: [{key: "a", value: "a"}]},
        {$type: "set", entries: [{key: "a"}]},
      ]);
    });

    it("sends updates for each object when deleting everything", async () => {
      await svc.set([{key: "a", value: "a"}]);
      await svc.set([{key: "b", value: "b"}]);
      await events.nextN(svc.onSet, 2);

      await svc.deleteAll();
      await events.next(svc.onSet);

      expect(client.received).to.deep.equal([
        {$type: "set", entries: [{key: "a", value: "a"}]},
        {$type: "set", entries: [{key: "b", value: "b"}]},
        {$type: "set", entries: [{key: "a"}, {key: "b"}]},
      ]);
    });
  });
});

// Consider using a mocking library if this gets to be too much
class MockPort implements P.ClientPort<string, string> {
  readonly name: string = "";

  received: P.ClientMsg<string, string>[] = [];

  // istanbul ignore next
  request(
    msg: P.ServiceMsg<string, string>,
  ): Promise<P.ClientMsg<string, string>> {
    throw new Error(`Services shouldn't make requests: ${msg}`);
  }

  notify(msg: P.ServiceMsg<string, string>) {
    // We do a round-trip thru JSON to ensure nothing else is holding on to
    // references to the message we received...
    this.received.push(JSON.parse(JSON.stringify(msg)));
  }

  // istanbul ignore next
  disconnect() {}
}
