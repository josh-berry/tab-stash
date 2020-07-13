// Send must be serializable to JSON.  As a small concession to JS, we allow
// undefined... but callers should be aware that any explicit undefined will
// be omitted when sent.
export type Send = undefined | null | boolean | number | string
                 | {[k: string]: Send}
                 | Send[];

// The NanoService communication protocol.
type Envelope<M extends Send> =
    NotifyEnvelope<M> | RequestEnvelope<M> | ResponseEnvelope<M>;

type NotifyEnvelope<M extends Send> = {notify: M};

type RequestEnvelope<M extends Send> = {tag: string, request: M};

type ResponseEnvelope<M extends Send> = {tag: string} & Response<M>;
type Response<M extends Send> = {response: M} | {error: ErrorResponse};
type ErrorResponse = {
    name: string,
    message?: string,
    stack?: string,
    data?: Send,
};

export class NanoServiceRegistry {
    private services = new Map<string, NanoService<Send, Send>>();
    private listener = (port: Port) => {
        const svc = this.services.get(port.name);
        if (! svc) return;

        if (port.name !== svc.name) return;

        const nport = new NanoPort<Send, Send>(port);
        nport.onDisconnect = () => svc.onDisconnect(nport);
        nport.onRequest = msg => svc.onRequest(nport, msg);
        nport.onNotify = msg => svc.onNotify(nport, msg);

        svc.onConnect(nport);
    };

    constructor() {
        this.reset();
    }

    // This is factored out as a separate function so we can use it in unit tests
    private reset() {
        this.services.clear();
        browser.runtime.onConnect.addListener(this.listener);
    }

    register(svc: NanoService<Send, Send>) {
        if (this.services.has(svc.name)) {
            throw new Error(`Service ${svc.name} is already launched`);
        }
        this.services.set(svc.name, svc);
    }
}

export const registry = new NanoServiceRegistry();

// NOTE: This is a very slim base class which is intended to be extended--the
// reason for this is actually debuggability.  All NanoServices are registered
// in a global NanoServiceRegistry, and forcing users to derive from NanoService
// makes it easy to get at service-specific state.
export class NanoService<ClientMsg extends Send, ServerMsg extends Send> {
    readonly name: string;

    constructor(name: string, reg?: NanoServiceRegistry) {
        this.name = name;
        (reg ?? registry).register(this as unknown as NanoService<Send, Send>);
    }

    // XXX these should be protected and module-level visible
    onConnect(port: NanoPort<ServerMsg, ClientMsg>): void {}
    onDisconnect(port: NanoPort<ServerMsg, ClientMsg>): void {}
    onRequest(port: NanoPort<ServerMsg, ClientMsg>, msg: ClientMsg): Promise<ServerMsg> {
        return not_implemented();
    }
    onNotify(port: NanoPort<ServerMsg, ClientMsg>, msg: ClientMsg): void {
        this.onRequest(port, msg);
    }
}

export class NanoPort<SentMsg extends Send, ReceivedMsg extends Send> {
    defaultTimeoutMS = 2000;

    onDisconnect: (port: NanoPort<SentMsg, ReceivedMsg>) => void = () => {};
    onRequest: (msg: ReceivedMsg) => Promise<SentMsg> = not_implemented;
    onNotify: (msg: ReceivedMsg) => void = msg => this.onRequest(msg);

    private port: Port;
    private pending: Map<string, PendingMsg<ReceivedMsg>> = new Map();

    static connect<MM extends Send, PM extends Send>(
        name: string
    ): NanoPort<MM, PM> {
        return new NanoPort(browser.runtime.connect(undefined, {name}));
    }

    constructor(port: Port) {
        this.port = port;

        this.port.onDisconnect.addListener(() => {
            this._flushPendingOnDisconnect();
            this.onDisconnect(this);
        });

        this.port.onMessage.addListener(((msg: Envelope<ReceivedMsg>) => {
            if (! msg) return;
            if ('tag' in msg) {
                if ('request' in msg) {
                    this._handleRequest(msg);

                } else if ('response' in msg || 'error' in msg) {
                    this._handleResponse(msg);
                }

            } else if ('notify' in msg) {
                this.onNotify(msg.notify as ReceivedMsg);
            }
        }) as (msg: object) => void);
    }

    get error(): undefined | {message?: string} { return this.port.error; }

    disconnect() {
        this.port.disconnect();
        this._flushPendingOnDisconnect();
    }

    request(request: SentMsg, options?: {timeout_ms?: number}): Promise<ReceivedMsg> {
        return new Promise((resolve, reject) => {
            // XXX higher-quality randomness?
            let tag = Math.random().toString();
            while (this.pending.has(tag)) tag = Math.random().toString();

            this.port.postMessage({tag, request} as RequestEnvelope<SentMsg>);

            this.pending.set(tag, {
                resolve, reject,
                timeout_id: setTimeout(
                    () => {
                        this.pending.delete(tag);
                        reject(new NanoTimeoutError(request));
                    },
                    options?.timeout_ms ?? this.defaultTimeoutMS),
            });
        });
    }

    notify(notify: SentMsg) {
        try {
            this.port.postMessage({notify} as NotifyEnvelope<SentMsg>);
        } catch (e) {
            // If we are unable to send due to a disconnected port, the message
            // is simply dropped.
        }
    }

    private _flushPendingOnDisconnect() {
        for (const [, pending] of this.pending) {
            pending.reject(new Error("Disconnected"));
        }
        this.pending.clear();
    }

    private async _handleRequest(msg: RequestEnvelope<ReceivedMsg>) {
        let res: Response<SentMsg>;

        try {
            res = {response: await this.onRequest(msg.request as ReceivedMsg)};

        } catch (e) {
            let data: Send;
            try {
                data = JSON.parse(JSON.stringify(e));
            } catch (ee) {
                data = {};
            }

            if (e instanceof Error) {
                res = {error: {
                    name: e.name, message: e.message, stack: e.stack, data
                }};
            } else if (e instanceof Object) {
                res = {error: { name: e.constructor.name, data}};
            } else {
                res = {error: {name: '', data}};
            }
        }

        const resmsg: ResponseEnvelope<SentMsg> = {tag: msg.tag, ...res};

        try {
            this.port.postMessage(resmsg);
        } catch (e) {
            // If the other side becomes disconnected before we can send the
            // reply, just drop it.  We should get a disconnection event later.
        }
    }

    private _handleResponse(msg: ResponseEnvelope<ReceivedMsg>) {
        const handler = this.pending.get(msg.tag);
        if (! handler) return;

        if ('response' in msg) {
            handler.resolve(msg.response);
        } else {
            handler.reject(new RemoteNanoError(msg.error));
        }
    }
}

export class RemoteNanoError extends Error {
    readonly remote: ErrorResponse;

    constructor(remote: ErrorResponse) {
        super(remote.message);
        this.remote = remote;
    }

    get name(): string { return this.remote.name; }
    get stack(): string | undefined { return `[remote stack] ${this.remote.stack}`; }
    get data(): Send { return this.remote.data; }
}

export class NanoTimeoutError extends Error {
    readonly request: Send;
    constructor(request: Send) {
        super("Request timeout");
        this.name = 'NanoTimeoutError';
        this.request = request;
    }
}

type PendingMsg<M extends Send> = {
    resolve: (msg: M) => void,
    reject: (err: Error) => void,
    timeout_id: ReturnType<typeof setTimeout>,
};

type Port = browser.runtime.Port;

function not_implemented(): Promise<any> {
    const e = new Error('No request handler defined');
    e.name = 'NotImplemented';
    return Promise.reject(e);
}
