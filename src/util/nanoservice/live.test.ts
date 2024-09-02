import {expect} from "chai";
import type {Runtime} from "webextension-polyfill";
import browser from "webextension-polyfill";

import * as events from "../../mock/events.js";

import * as M from "./index.js";
import * as Live from "./live.js";
import type {Send} from "./proto.js";

type Port = Runtime.Port;

describe("util/nanoservice", function () {
  describe("NanoPort", function () {
    async function port_pair<S extends M.Send, R extends M.Send>(
      name: string,
    ): Promise<[M.NanoPort<S, R>, Port]> {
      const port = M.connect<S, R>("test");
      const [svc_port] = await events.next(browser.runtime.onConnect);

      expect(port).not.to.be.undefined;
      expect(svc_port.name).to.equal("test");
      return [port, svc_port];
    }

    it("raises disconnection events on self-disconnect", async function () {
      const [port, svc_port] = await port_pair("test");
      let onDisconnectFired = false;

      port.onDisconnect = p => {
        expect(p).to.equal(port);
        onDisconnectFired = true;
      };
      port.disconnect();

      await events.next(svc_port.onDisconnect);
      expect(onDisconnectFired).to.equal(true);
    });

    it("raises disconnection events", async function () {
      const [client, svc] = await port_pair("test");
      let calls = 0;
      client.onDisconnect = (c: M.NanoPort<Send, Send>) => {
        expect(c).to.equal(client);
        ++calls;
      };
      svc.disconnect();
      await events.next("browser.runtime.onDisconnect");
      expect(calls).to.equal(1);
    });

    it("sends notifications", async function () {
      const [client, svc] = await port_pair("test");
      client.notify(42);
      expect((await events.next(svc.onMessage))[0]).to.deep.equal({notify: 42});
    });

    it("receives notifications", async function () {
      const [client, svc] = await port_pair("test");
      let calls = 0;
      client.onNotify = (msg: Send) => {
        expect(msg).to.deep.equal(37);
        ++calls;
      };
      svc.postMessage({notify: 37});
      await events.next("browser.runtime.onMessage");
      expect(calls).to.deep.equal(1);
    });

    it("handles notifications as requests if no onNotify is set", async function () {
      const [client, svc] = await port_pair("test");
      let res = undefined;

      client.onRequest = async v => {
        res = v;
        return null;
      };
      svc.postMessage({notify: 26});
      await events.next("browser.runtime.onMessage");
      expect(res).to.equal(26);
    });

    it("sends requests and receives responses", async function () {
      const messages = events.watch("browser.runtime.onMessage");
      const [client, svc] = await port_pair("test");
      svc.onMessage.addListener(req =>
        svc.postMessage({tag: req.tag, response: "meow!"}),
      );

      const req_p = client.request("meow?");
      const [req_msg] = await messages.next();
      expect(req_msg).to.deep.include({request: "meow?"});

      const [resp_msg] = await messages.next();
      expect(resp_msg).to.deep.include({tag: req_msg.tag, response: "meow!"});

      expect(await req_p).to.equal("meow!");
    });

    it("receives requests and sends responses", async function () {
      const [client, svc] = await port_pair<number, number>("test");
      let received = false;

      client.onRequest = async v => {
        received = true;
        return v + 24;
      };

      svc.postMessage({tag: "hi", request: 8});
      await events.next("browser.runtime.onMessage");
      expect(received).to.equal(true);

      expect((await events.next(svc.onMessage))[0]).to.deep.equal({
        tag: "hi",
        response: 32,
      });
    });

    it("sends requests and throws errors", async function () {
      const [client, svc] = await port_pair("test");
      svc.onMessage.addListener((req: any) =>
        svc.postMessage({
          tag: req.tag,
          error: {
            name: "Oops",
            message: "oops",
            data: {
              value: 42,
              fn: /* istanbul ignore next */ () => {},
            },
          },
        }),
      );

      try {
        const req_p = client.request(42);
        await events.next(svc.onMessage);
        await events.next("browser.runtime.onMessage");
        await req_p;
        /* c8 ignore start */
        throw "unreachable";
        /* c8 ignore stop */
      } catch (e: any) {
        expect(e).to.be.instanceOf(M.RemoteNanoError);
        expect(e.name).to.equal("Oops");
        expect(e.message).to.equal("oops");
        expect(e.data).to.deep.equal({value: 42});
        expect(typeof e.stack).to.equal("string");
        expect(e.remote).to.deep.include({
          name: "Oops",
          message: "oops",
          data: {value: 42},
        });
      }
    });

    it("receives requests and returns errors", async function () {
      const [client, svc] = await port_pair("test");
      let received = false;

      client.onRequest = async v => {
        received = true;
        throw new Error("oops");
      };

      svc.postMessage({tag: "what", request: 0});
      await events.next("browser.runtime.onMessage");
      expect(received).to.equal(true);

      const err_msg = (await events.next(svc.onMessage))[0];
      expect(err_msg).to.be.an("object");
      expect(err_msg.tag).to.equal("what");
      expect(err_msg.error).to.be.an("object");
      expect(err_msg.error).to.deep.include({name: "Error", message: "oops"});
    });

    describe("correctly throws weird values", () => {
      const check = (throws: any, returns: any) => async () => {
        const [client, svc] = await port_pair("test");
        client.onRequest = async v => {
          throw throws;
        };

        svc.postMessage({tag: "what", request: 0});
        await events.next("browser.runtime.onMessage");

        const err_msg = (await events.next(svc.onMessage))[0];
        expect(err_msg.tag).to.equal("what");
        expect(err_msg.error).to.deep.include(returns);
      };

      it("...numbers", check(42, {name: "", data: 42}));
      it("...strings", check("oops", {name: "", data: "oops"}));
      it(
        "...functions",
        check(/* istanbul ignore next */ () => {}, {name: "Function"}),
      );
      it(
        "...objects",
        check({oops: "object"}, {name: "Object", data: {oops: "object"}}),
      );
      it(
        "...objects with functions",
        check(
          {oops: "o", fn: /* istanbul ignore next */ () => {}},
          {name: "Object", data: {oops: "o"}},
        ),
      );
    });

    it("sends multiple requests at once", async function () {
      const [client, svc] = await port_pair("test");

      const seenTags = new Set();
      svc.onMessage.addListener((ev: any) => {
        expect(ev.tag).to.be.a("string");
        expect(seenTags.has(ev.tag)).to.be.false;
        seenTags.add(ev.tag);
        svc.postMessage({tag: ev.tag, response: ev.request});
      });
      const a = client.request(1);
      const b = client.request(2);
      await events.nextN("browser.runtime.onMessage", 4);
      expect(await a).to.equal(1);
      expect(await b).to.equal(2);
    });

    it("receives multiple requests at once", async function () {
      const [client, svc] = await port_pair<number, number>("test");

      let count = 0;
      client.onRequest = async req => req + 4;
      svc.postMessage({tag: "a", request: 10});
      svc.postMessage({tag: "b", request: 20});
      svc.onMessage.addListener((msg: any) => {
        switch (count) {
          case 0:
            expect(msg.tag).to.equal("a");
            expect(msg.response).to.equal(14);
            break;
          case 1:
            expect(msg.tag).to.equal("b");
            expect(msg.response).to.equal(24);
            break;
          /* c8 ignore next 2 */
          default:
            expect(false).to.be.true;
        }
        ++count;
      });
      await events.nextN("browser.runtime.onMessage", 4);
      expect(count).to.equal(2);
    });

    it("times out if no response is received to a request", async function () {
      const [client] = await port_pair("test");
      const p = client.request("void", {timeout_ms: 20});
      await events.next("browser.runtime.onMessage");
      try {
        await p;
      } catch (e: any) {
        expect(e).to.be.instanceOf(M.NanoTimeoutError);
        expect(e.name).to.equal("NanoTimeoutError");
        expect(e.request).to.equal("void");
      }
    });

    it("drops notifications to disconnected ports", async function () {
      const [client, svc] = await port_pair("test");
      svc.disconnect();
      await events.next("browser.runtime.onDisconnect");
      client.notify(42);
    });

    it("throws when requesting from a disconnected port", async function () {
      const [client, svc] = await port_pair("test");
      svc.disconnect();
      await events.next("browser.runtime.onDisconnect");
      try {
        await client.request(42);
        /* c8 ignore next */ throw "unreachable";
      } catch (e) {
        expect(e).to.be.instanceOf(Error);
        expect(e).to.not.be.instanceOf(M.RemoteNanoError);
      }
    });

    it("drops malformed messages", async function () {
      const [client, svc] = await port_pair("test");
      let called = false;
      /* c8 ignore next 4 */
      client.onRequest = async () => {
        called = true;
        return null;
      };

      svc.postMessage(42);
      svc.postMessage("hi");
      svc.postMessage(["r", "u", "there"]);
      svc.postMessage({status: "online"});
      svc.postMessage({tag: "42", status: "online"});

      await events.nextN("browser.runtime.onMessage", 5);
      expect(called).to.be.false;
    });

    it("drops responses to requests it didn't send", async () => {
      const [client, svc] = await port_pair("test");
      let called = false;
      /* c8 ignore next 4 */
      client.onRequest = async () => {
        called = true;
        return null;
      };

      svc.postMessage({tag: "42", response: "online"});
      svc.postMessage({tag: "42", error: "failed"});

      await events.nextN("browser.runtime.onMessage", 2);
      expect(called).to.be.false;
    });

    it("drops replies to disconnected ports", async function () {
      const [client, svc] = await port_pair("test");
      const dest = new Live.Port("test_port", svc);
      const p = client.request(42);
      dest.disconnect();
      await events.next("browser.runtime.onMessage");
      await events.next("browser.runtime.onDisconnect");
      try {
        await p;
        /* c8 ignore next */ throw "unreachable";
      } catch (e) {
        expect(e).to.be.instanceOf(Error);
        expect(e).to.not.be.instanceOf(M.RemoteNanoError);
      }
    });

    it("rejects pending requests when disconnected", async function () {
      const [client] = await port_pair("test");
      const p = client
        .request(42)
        .then(
          /* c8 ignore next 3 */
          () => {
            throw new Error("Unreachable code");
          },
        )
        .catch(e => {
          expect(e).to.be.instanceOf(Error);
          expect(e).to.not.be.instanceOf(M.RemoteNanoError);
        });
      client.disconnect(); // <== key difference from the above test
      await events.next("browser.runtime.onMessage");
      await events.next("browser.runtime.onDisconnect");
      await p;
    });

    it("force-disconnects if sending a request fails", async () => {
      const [client] = await port_pair("test");
      let onDisconnectFired = false;

      (<any>client).port.error = new Error("oops");
      client.onDisconnect = port => {
        expect(client).to.equal(port);
        onDisconnectFired = true;
      };

      try {
        await client.request(42);
        /* c8 ignore next */ throw "unreachable";
      } catch (e: any) {
        expect(e.message).to.equal("oops");
      }

      await events.next("browser.runtime.onDisconnect");
      expect(onDisconnectFired).to.equal(true);
    });
  });

  describe("NanoService", function () {
    beforeEach(() => M.registry.reset_testonly());

    it("ignores connections for other services", async () => {
      let count = 0;
      M.listen("test", {
        /* c8 ignore next 3 */
        onConnect() {
          ++count;
        },
      });

      M.connect("other");
      await events.next("browser.runtime.onConnect");
      expect(count).to.equal(0);
    });

    it("fires connection events", async function () {
      let count = 0;
      M.listen("test", {
        onConnect() {
          ++count;
        },
      });

      M.connect("test");
      await events.next("browser.runtime.onConnect");
      expect(count).to.equal(1);
    });

    it("fires disconnection events", async function () {
      let count = 0;
      M.listen("test", {
        onDisconnect() {
          ++count;
        },
      });

      M.connect("test").disconnect();
      await events.next("browser.runtime.onConnect");
      await events.next("browser.runtime.onDisconnect");
      expect(count).to.equal(1);
    });

    it("receives notifications", async function () {
      let notified = false;
      M.listen("test", {
        onNotify(port, msg) {
          expect(port).to.be.instanceOf(Live.Port);
          expect(msg).to.equal(42);
          notified = true;
        },
      });

      M.connect("test").notify(42);
      await events.next("browser.runtime.onConnect");
      await events.next("browser.runtime.onMessage");
      expect(notified).to.be.true;
    });

    it("responds to requests with failure if onRequest() is not defined", async () => {
      M.listen("test", {});
      const p = M.connect("test").request(42);
      await events.next("browser.runtime.onConnect");
      await events.nextN("browser.runtime.onMessage", 2);
      try {
        await p;
        /* c8 ignore next */ throw "unreachable";
      } catch (e: any) {
        expect(e).to.be.instanceOf(M.RemoteNanoError);
        expect(e.name).to.equal("NotImplemented");
      }
    });

    it("responds to requests", async () => {
      M.listen("test", {
        async onRequest(sender, msg: number) {
          expect(msg).to.equal(17);
          return msg + 2;
        },
      });

      const port = M.connect("test");
      const p = port.request(17);
      await events.next("browser.runtime.onConnect");
      await events.nextN("browser.runtime.onMessage", 2);
      expect(await p).to.equal(19);
    });

    it("responds to requests which fail", async () => {
      M.listen("test", {
        async onRequest(sender, msg) {
          throw new ReferenceError("oops");
        },
      });

      try {
        const p = M.connect("test").request(17);
        await events.next("browser.runtime.onConnect");
        await events.nextN("browser.runtime.onMessage", 2);
        await p;
        /* c8 ignore next */ throw "unreachable";
      } catch (e: any) {
        expect(e).to.be.instanceOf(M.RemoteNanoError);
        expect(e.name).to.equal("ReferenceError");
        expect(e.message).to.equal("oops");
      }
    });

    it("responds to parallel requests", async () => {
      M.listen("test", {
        async onRequest(sender, msg: number) {
          return msg + 4;
        },
      });

      const port1 = M.connect("test");
      const port2 = M.connect("test");
      await events.nextN("browser.runtime.onConnect", 2);

      const p1 = port1.request(4);
      const p2 = port2.request(8);
      await events.nextN("browser.runtime.onMessage", 4);
      expect(await p1).to.equal(8);
      expect(await p2).to.equal(12);
    });

    it("treats notifications as requests if onNotify() is not defined", async () => {
      M.listen("test", {
        async onRequest(sender, msg: number) {
          expect(msg).to.equal(89);
          received = true;
          return 0;
        },
      });

      let received = true;
      M.connect("test").notify(89);
      await events.next("browser.runtime.onConnect");
      await events.next("browser.runtime.onMessage");
      expect(received).to.be.true;
    });
  });
});
