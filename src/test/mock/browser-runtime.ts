import {MockEventDispatcher} from './events';

class MockPort {
    name?: string;
    error?: object;
    onDisconnect = new MockEventDispatcher<(p: MockPort) => void>();
    onMessage = new MockEventDispatcher<(msg: any) => void>();

    private _peer: MockPort;

    static make_pair(name?: string): [MockPort, MockPort] {
        const left = new MockPort(name);
        const right = new MockPort(name);
        left._peer = right;
        right._peer = left;
        return [left, right];
    }

    constructor(name?: string) {
        this._peer = undefined!; // set later in make_pair()
        this.name = name;
    }

    disconnect() {
        this.error = {message: 'Disconnected'};
        this._peer.error = {message: 'Disconnected'};
        this._peer.onDisconnect.send(this);
    }

    postMessage(msg: any) {
        if (this.error) return;
        if (this._peer.error) return;
        this._peer.onMessage.send(JSON.parse(JSON.stringify(msg)));
    }

    async drain(): Promise<number> {
        let count = 0;
        count += await this.onDisconnect.drain();
        count += await this.onMessage.drain();
        return count;
    }
}

export default (() => {
    const exports = {
        onConnect: new MockEventDispatcher<(p: MockPort) => void>(),

        client_ports: [] as MockPort[],
        server_ports: [] as MockPort[],

        reset() {
            if (! (<any>globalThis).browser) (<any>globalThis).browser = {};

            exports.onConnect = new MockEventDispatcher();

            (<any>globalThis).browser.runtime = {
                getPlatformInfo() {
                    return new Promise((resolve, reject) => {
                        resolve({os: 'unknown', arch: 'unknown'});
                    });
                },

                onConnect: exports.onConnect,

                connect(extn_id?: string, info?: {name?: string}): MockPort {
                    const name = info && info.name;
                    const [client, server] = MockPort.make_pair(name);
                    exports.onConnect.send(server);
                    exports.client_ports.push(client);
                    exports.server_ports.push(server);
                    return client;
                }
            };
        },

        async drain(): Promise<number> {
            let count = 0;
            count += await exports.onConnect.drain();
            for (const p of exports.client_ports) count += await p.drain();
            for (const p of exports.server_ports) count += await p.drain();
            return count;
        }
    };

    exports.reset();

    return exports;
})();
