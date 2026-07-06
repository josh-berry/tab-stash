import type {Runtime} from "webextension-polyfill";
import browser from "webextension-polyfill";

import {trace_fn} from "../debug.js";
import {logErrorsFrom} from "../oops.js";
import {makeRandomString} from "../random.js";
import type {NanoPort, NanoService} from "./index.js";
import {
  NanoDisconnectedError,
  NanoTimeoutError,
  RemoteNanoError,
} from "./index.js";
import type {
  Envelope,
  NotifyEnvelope,
  RequestEnvelope,
  Response,
  ResponseEnvelope,
  Send,
} from "./proto.js";

let listener_count = 0;

/* c8 ignore next -- pathname is never set in tests */
const trace = trace_fn("nano_port", globalThis?.location?.pathname);

type ParkedPort = {
  port: RTPort;
  buffered: object[];
  onMessage: (msg: object) => void;
  onDisconnect: () => void;
};

export class SvcRegistry {
  private services = new Map<string, NanoService<Send, Send>>();
  private parked = new Map<string, Set<ParkedPort>>();
  private eager = false;
  private listening = false;

  private listener = (port: RTPort) => {
    const svc = this.services.get(port.name);
    if (!svc) {
      if (this.eager) {
        // The service may still be initializing (e.g. we are a service
        // worker that was just woken up by this connection); hold on to the
        // port until the service is registered.
        trace(`[listener] parking connection for ${port.name}`);
        this._park(port);
      } else {
        // Probably intended for another audience.
        trace(`[listener] ignored connection for ${port.name}`);
      }
      return;
    }

    this._accept(port, svc);
  };

  reset_testonly() {
    this.services.clear();
    this.parked.clear();
    this.eager = false;
    this.listening = false;
    browser.runtime.onConnect.removeListener(this.listener);
  }

  /** Start listening for connections immediately, even before any service is
   * registered.  Connections for not-yet-registered services are parked, and
   * their messages buffered, until register() is called with a matching name.
   *
   * This is required in a MV3 service worker: the worker may be started BY an
   * incoming connection, which is delivered as soon as top-level code has
   * run--if we waited for services to be registered (which happens only after
   * several async operations), the connection would be dropped.
   *
   * We don't do this on Firefox because of bug 1465514--listening for ANY
   * connections and then dropping a connection may result in other, unrelated
   * connections getting spuriously dropped. */
  listenEagerly() {
    this.eager = true;
    if (!this.listening) {
      this.listening = true;
      browser.runtime.onConnect.addListener(this.listener);
    }
  }

  register(name: string, svc: NanoService<Send, Send>) {
    /* c8 ignore next 3 -- not worth testing */
    if (this.services.has(name)) {
      throw new Error(`Service ${name} is already launched`);
    }

    trace("[listener] listening for service", name);
    this.services.set(name, svc);

    if (!this.listening) {
      // We wait to start listening until the first service is actually
      // registered, because of Firefox bug 1465514--listening for ANY
      // connections and then dropping a connection may result in other,
      // unrelated connections getting spuriously dropped.
      this.listening = true;
      browser.runtime.onConnect.addListener(this.listener);
    }

    // Hand over any connections that arrived before the service was
    // registered, replaying any messages they sent in the meantime.
    const parked = this.parked.get(name);
    if (parked) {
      this.parked.delete(name);
      for (const p of parked) {
        p.port.onMessage.removeListener(p.onMessage);
        p.port.onDisconnect.removeListener(p.onDisconnect);
        const nport = this._accept(p.port, svc);
        for (const msg of p.buffered) nport.deliverMessage(msg);
      }
    }
  }

  private _accept(
    port: RTPort,
    svc: NanoService<Send, Send>,
  ): Port<Send, Send> {
    ++listener_count;
    const nport = new Port<Send, Send>(`${port.name}<${listener_count}`, port);
    nport.onDisconnect = () => {
      if (svc.onDisconnect) svc.onDisconnect(nport);
    };
    nport.onRequest = msg => {
      if (svc.onRequest) return svc.onRequest(nport, msg);
      return not_implemented();
    };
    nport.onNotify = msg => {
      if (svc.onNotify) svc.onNotify(nport, msg);
      else if (svc.onRequest) svc.onRequest(nport, msg);
    };

    trace(`[listener] Accepted connection for ${port.name} as ${nport.name}`);
    if (svc.onConnect) svc.onConnect(nport);
    return nport;
  }

  private _park(port: RTPort) {
    const parked: ParkedPort = {
      port,
      buffered: [],
      onMessage: msg => parked.buffered.push(msg),
      onDisconnect: () => {
        port.onMessage.removeListener(parked.onMessage);
        port.onDisconnect.removeListener(parked.onDisconnect);
        this.parked.get(port.name)?.delete(parked);
      },
    };
    port.onMessage.addListener(parked.onMessage);
    port.onDisconnect.addListener(parked.onDisconnect);

    let set = this.parked.get(port.name);
    if (!set) {
      set = new Set();
      this.parked.set(port.name, set);
    }
    set.add(parked);
  }
}

export const registry = new SvcRegistry();

export class Port<S extends Send, R extends Send> implements NanoPort<S, R> {
  static connect<MM extends Send, PM extends Send>(name: string): Port<MM, PM> {
    trace("connect", name);
    return new Port(name, browser.runtime.connect(undefined, {name}));
  }

  readonly name: string;
  defaultTimeoutMS = 30000;

  onDisconnect?: (port: NanoPort<S, R>) => void;
  onRequest?: (msg: R) => Promise<S>;
  onNotify?: (msg: R) => void;

  private port: RTPort;
  private pending: Map<string, PendingMsg<R>> = new Map();

  constructor(name: string, port: RTPort) {
    this.name = name;
    this.port = port;

    this.port.onDisconnect.addListener(() => {
      this._trace("disconnected");
      this._flushPendingOnDisconnect();
      if (this.onDisconnect) this.onDisconnect(this);
    });

    this.port.onMessage.addListener((msg: object) => this.deliverMessage(msg));

    this._trace("create");
  }

  /** Handles a message received on the port.  Also called by SvcRegistry to
   * replay messages which arrived while the port was parked awaiting service
   * registration. */
  deliverMessage(rawMsg: object) {
    const msg = rawMsg as Envelope<R>;
    this._trace("recv", msg);
    if (typeof msg !== "object") return;

    if ("tag" in msg) {
      if ("request" in msg) {
        logErrorsFrom(() => this._handleRequest(msg));
      } else if ("response" in msg || "error" in msg) {
        this._handleResponse(msg);
      }
    } else if ("notify" in msg) {
      if (this.onNotify) this.onNotify(msg.notify as R);
      else {
        if (this.onRequest) this.onRequest(msg.notify as R);
      }
    }
  }

  disconnect() {
    this._trace("disconnect");
    this.port.disconnect();
    this._flushPendingOnDisconnect();
    if (this.onDisconnect) this.onDisconnect(this);
  }

  request(request: S, options?: {timeout_ms?: number}): Promise<R> {
    return new Promise((resolve, reject) => {
      let tag = makeRandomString(4);
      /* c8 ignore next -- tag collisions happen very rarely */
      while (this.pending.has(tag)) tag = makeRandomString(4);

      this._trace("send", {tag, request});
      try {
        this.port.postMessage({tag, request} as RequestEnvelope<S>);
      } catch (e) {
        // Force-disconnect the port because it's probably in an invalid
        // state, and the caller needs to recover.
        this.disconnect();
        throw e;
      }

      this.pending.set(tag, {
        resolve,
        reject,
        timeout_id: setTimeout(() => {
          this.pending.delete(tag);
          reject(new NanoTimeoutError(this.name, request, tag));
        }, options?.timeout_ms ?? this.defaultTimeoutMS),
      });
    });
  }

  notify(notify: S) {
    try {
      this._trace("send", {notify});
      this.port.postMessage({notify} as NotifyEnvelope<S>);
    } catch (e) {
      // Force-disconnect the port because it's probably in an invalid
      // state, and the caller needs to recover.
      this.disconnect();

      // We swallow the exception here because the caller isn't expecting
      // a response--so the notification need not actually be sent.
    }
  }

  private _flushPendingOnDisconnect() {
    for (const [tag, pending] of this.pending) {
      this._trace("flush on disconnect", tag);
      pending.reject(new NanoDisconnectedError(this.name, tag));
      clearTimeout(pending.timeout_id);
    }
    this.pending.clear();
  }

  private async _handleRequest(msg: RequestEnvelope<R>) {
    let res: Response<S>;

    try {
      if (!this.onRequest) await not_implemented();
      res = {response: await this.onRequest!(msg.request as R)};
    } catch (e) {
      let data: Send;
      try {
        data = JSON.parse(JSON.stringify(e));
      } catch (ee) {
        data = `${e}`;
      }

      if (e instanceof Error) {
        res = {
          error: {
            name: e.name,
            message: e.message,
            stack: e.stack,
            data,
          },
        };
      } else if (e instanceof Object) {
        res = {error: {name: e.constructor.name, data}};
      } else {
        res = {error: {name: "", data}};
      }
    }

    const resmsg: ResponseEnvelope<S> = {tag: msg.tag, ...res};

    try {
      this._trace("send", resmsg);
      this.port.postMessage(resmsg);
    } catch (e) {
      // If the other side becomes disconnected before we can send the
      // reply, just drop it.  We should get a disconnection event later.
      this._trace("dropped reply to request:", msg, "error:", e);
    }
  }

  private _handleResponse(msg: ResponseEnvelope<R>) {
    const handler = this.pending.get(msg.tag);
    if (!handler) return;

    clearTimeout(handler.timeout_id);
    if ("response" in msg) {
      handler.resolve(msg.response);
    } else {
      handler.reject(new RemoteNanoError(msg.error));
    }
  }

  private _trace(...args: any[]) {
    trace(`[${this.name}]`, ...args);
  }
}

type PendingMsg<M extends Send> = {
  resolve: (msg: M) => void;
  reject: (err: Error) => void;
  timeout_id: ReturnType<typeof setTimeout>;
};

type RTPort = Runtime.Port;

function not_implemented(): Promise<any> {
  const e = new Error("No request handler defined");
  e.name = "NotImplemented";
  return Promise.reject(e);
}
