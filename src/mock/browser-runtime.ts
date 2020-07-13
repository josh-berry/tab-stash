import * as events from './events';

let verbose = false;

class MockPort {
    id: string;
    name?: string;
    error?: object;
    onDisconnect: events.MockEventDispatcher<(p: MockPort) => void>;
    onMessage: events.MockEventDispatcher<(msg: any) => void>;

    private _peer: MockPort;

    static make_pair(id: number, name?: string): [MockPort, MockPort] {
        const client = new MockPort(`C${id}`, name);
        const server = new MockPort(`S${id}`, name);
        client._peer = server;
        server._peer = client;
        return [client, server];
    }

    constructor(id: string, name?: string) {
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
        if (this._peer.error) throw this._peer.error;

        if (verbose) console.log(`${this.id} -> ${this._peer.id}`, msg);
        this._peer.onMessage.send(JSON.parse(JSON.stringify(msg)));
    }
}

export default (() => {
    const exports = {
        onConnect: new events.MockEventDispatcher<(p: MockPort) => void>(''),

        client_ports: [] as MockPort[],
        server_ports: [] as MockPort[],

        trace(t: boolean) { verbose = t; },

        reset() {
            events.expect_empty();
            events.trace(false);

            verbose = false;

            if (! (<any>globalThis).browser) (<any>globalThis).browser = {};

            exports.onConnect = new events.MockEventDispatcher('rt.onConnect');
            exports.client_ports = [];
            exports.server_ports = [];

            (<any>globalThis).browser.runtime = {
                getPlatformInfo() {
                    return new Promise((resolve, reject) => {
                        resolve({os: 'unknown', arch: 'unknown'});
                    });
                },

                onConnect: exports.onConnect,

                connect(extn_id?: string, info?: {name?: string}): MockPort {
                    const id = exports.client_ports.length;
                    const name = info && info.name;
                    const [client, server] = MockPort.make_pair(id, name);

                    exports.client_ports.push(client);
                    exports.server_ports.push(server);
                    exports.onConnect.send(server);

                    if (verbose) {
                        console.log(`New connection ${name}: C${id} -> S{$id}`);
                    }

                    return client;
                }
            };
        },
    };

    exports.reset();

    return exports;
})();
