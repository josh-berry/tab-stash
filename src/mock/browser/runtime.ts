import type {Manifest, Runtime} from "webextension-polyfill";

import * as events from "../events";

let verbose = false;

class MockPort implements Runtime.Port {
  id: string;
  name: string;
  error?: Runtime.PortErrorType;
  onDisconnect: events.MockEvent<(p: Runtime.Port) => void>;
  onMessage: events.MockEvent<(msg: any, p: Runtime.Port) => void>;

  private _peer: MockPort;

  static make_pair(id: number, name: string): [MockPort, MockPort] {
    const client = new MockPort(`C${id}`, name);
    const server = new MockPort(`S${id}`, name);
    client._peer = server;
    server._peer = client;
    return [client, server];
  }

  constructor(id: string, name: string) {
    this._peer = undefined!; // set later in make_pair()
    this.id = id;
    this.name = name;
    this.onDisconnect = new events.MockEvent(
      "browser.runtime.onDisconnect",
      this.id,
    );
    this.onMessage = new events.MockEvent("browser.runtime.onMessage", this.id);
  }

  disconnect() {
    if (!this.error || this.error.message !== "Disconnected") {
      this.error = new Error("Disconnected");
      this._peer.error = new Error("Disconnected");
      this._peer.onDisconnect.send(this);
    }
  }

  postMessage(msg: any) {
    if (this.error) throw this.error;
    // istanbul ignore next
    if (this._peer.error) throw this._peer.error;

    // istanbul ignore next
    if (verbose) console.log(`${this.id} -> ${this._peer.id}`, msg);
    this._peer.onMessage.send(JSON.parse(JSON.stringify(msg)), this);
  }
}

export default (() => {
  const exports = {
    onConnect: new events.MockEvent<(p: MockPort) => void>(
      "browser.runtime.onConnect",
    ),

    client_ports: [] as MockPort[],
    server_ports: [] as MockPort[],

    // istanbul ignore next
    trace(t: boolean) {
      verbose = t;
    },

    reset() {
      verbose = false;

      exports.onConnect = new events.MockEvent("browser.runtime.onConnect");
      exports.client_ports = [];
      exports.server_ports = [];

      const runtime: Runtime.Static = {
        getPlatformInfo() {
          return new Promise((resolve, reject) => {
            resolve({os: "linux", arch: "x86-64"});
          });
        },

        getURL(path: string): string {
          return `extension://tab-stash/${path}`;
        },

        onConnect: exports.onConnect,

        connect(
          extn_id_or_info?: string | Runtime.ConnectConnectInfoType,
          info?: {name?: string},
        ): MockPort {
          // istanbul ignore next
          if (typeof extn_id_or_info === "object") info = extn_id_or_info;

          const id = exports.client_ports.length;
          // istanbul ignore next
          const name = info?.name ? info.name : "<unnamed>";
          const [client, server] = MockPort.make_pair(id, name);

          exports.client_ports.push(client);
          exports.server_ports.push(server);
          exports.onConnect.send(server);

          // istanbul ignore next
          if (verbose) {
            console.log(`New connection ${name}: C${id} -> S{$id}`);
          }

          return client;
        },

        // istanbul ignore next
        async getBackgroundPage() {
          throw "unimplemented";
        },
        // istanbul ignore next
        async openOptionsPage() {
          throw "unimplemented";
        },
        // istanbul ignore next
        getManifest(): Manifest.ManifestBase {
          throw "unimplemented";
        },
        // istanbul ignore next
        getFrameId(_target: any): number {
          throw "unimplemented";
        },
        // istanbul ignore next
        async setUninstallURL(url?: string) {
          throw "unimplemented";
        },
        // istanbul ignore next
        reload() {
          throw "unimplemented";
        },
        // istanbul ignore next
        connectNative(app: string): Runtime.Port {
          throw "unimplemented";
        },
        // istanbul ignore next
        async sendMessage() {
          throw "unimplemented";
        },
        // istanbul ignore next
        async sendNativeMessage() {
          throw "unimplemented";
        },
        // istanbul ignore next
        async getBrowserInfo() {
          throw "unimplemented";
        },
        // istanbul ignore next
        async requestUpdateCheck(): Promise<
          [
            Runtime.RequestUpdateCheckStatus,
            Runtime.RequestUpdateCheckCallbackDetailsType,
          ]
        > {
          throw new Error("Function not implemented.");
        },

        onStartup: new events.MockEvent("browser.runtime.onStartup"),
        onInstalled: new events.MockEvent("browser.runtime.onInstalled"),
        onUpdateAvailable: new events.MockEvent(
          "browser.runtime.onUpdateAvailable",
        ),
        onConnectExternal: new events.MockEvent(
          "browser.runtime.onConnectExternal",
        ),
        onMessage: new events.MockEvent("browser.runtime.onMessage"),
        onMessageExternal: new events.MockEvent(
          "browser.runtime.onMessageExternal",
        ),
        onSuspend: new events.MockEvent("browser.runtime.onSuspend"),
        onSuspendCanceled: new events.MockEvent(
          "browser.runtime.onSuspendCanceled",
        ),

        id: "testing",
      };
      (<any>globalThis).browser.runtime = runtime;
    },
  };

  exports.reset();

  return exports;
})();
