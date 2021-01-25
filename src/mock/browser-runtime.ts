import {browser, Manifest, Runtime} from 'webextension-polyfill-ts';
import {beforeEach} from 'mocha';

import * as events from './events';

let verbose = false;

class MockPort implements Runtime.Port {
    id: string;
    name: string;
    error?: object;
    onDisconnect: events.MockEventDispatcher<(p: Runtime.Port) => void>;
    onMessage: events.MockEventDispatcher<(msg: any, p: Runtime.Port) => void>;

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
        this.onDisconnect = new events.MockEventDispatcher(
            `${this.id}.onDisconnect`);
        this.onMessage = new events.MockEventDispatcher(
            `${this.id}.onMessage`);
    }

    disconnect() {
        this.error = new Error('Disconnected');
        this._peer.error = new Error('Disconnected');
        this._peer.onDisconnect.send(this);
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
        onConnect: new events.MockEventDispatcher<(p: MockPort) => void>(''),

        client_ports: [] as MockPort[],
        server_ports: [] as MockPort[],

        // istanbul ignore next
        trace(t: boolean) { verbose = t; },

        reset() {
            events.expect_empty();
            events.trace(false);

            verbose = false;

            if (! (<any>globalThis).browser) (<any>globalThis).browser = {};

            exports.onConnect = new events.MockEventDispatcher('rt.onConnect');
            exports.client_ports = [];
            exports.server_ports = [];

            browser.runtime = {
                getPlatformInfo() {
                    return new Promise((resolve, reject) => {
                        resolve({os: 'linux', arch: 'x86-64'});
                    });
                },

                getURL(path: string): string {
                    return `extension://tab-stash/${path}`;
                },

                onConnect: exports.onConnect,

                connect(extn_id?: string, info?: {name?: string}): MockPort {
                    const id = exports.client_ports.length;
                    // istanbul ignore next
                    const name = info?.name ? info.name : '<unnamed>';
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
                async getBackgroundPage() { throw "unimplemented"; },
                // istanbul ignore next
                async openOptionsPage() { throw "unimplemented"; },
                // istanbul ignore next
                getManifest(): Manifest.ManifestBase { throw "unimplemented"; },
                // istanbul ignore next
                async setUninstallURL(url?: string) { throw "unimplemented"; },
                // istanbul ignore next
                reload() { throw "unimplemented"; },
                // istanbul ignore next
                connectNative(app: string): Runtime.Port { throw "unimplemented"; },
                // istanbul ignore next
                async sendMessage() { throw "unimplemented"; },
                // istanbul ignore next
                async sendNativeMessage() { throw "unimplemented"; },
                // istanbul ignore next
                async getBrowserInfo() { throw "unimplemented"; },

                onStartup: new events.MockEventDispatcher("onStartup"),
                onInstalled: new events.MockEventDispatcher("onInstalled"),
                onUpdateAvailable: new events.MockEventDispatcher("onUpdateAvailable"),
                onConnectExternal: new events.MockEventDispatcher("onConnectExternal"),
                onMessage: new events.MockEventDispatcher("onMessage"),
                onMessageExternal: new events.MockEventDispatcher("onMessageExternal"),

                id: 'testing',
            };
        },
    };

    beforeEach(exports.reset);
    exports.reset();

    return exports;
})();
