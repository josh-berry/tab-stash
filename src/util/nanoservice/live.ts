import {NanoPort, NanoService, NanoTimeoutError, RemoteNanoError} from '.';
import {
    Envelope, NotifyEnvelope, RequestEnvelope, ResponseEnvelope, Response, Send,
} from './proto';
import {makeRandomString} from '../random';

export class SvcRegistry {
    private services = new Map<string, NanoService<Send, Send>>();
    private listener = (port: RTPort) => {
        const svc = this.services.get(port.name);
        if (! svc) return;

        const nport = new Port<Send, Send>(port);
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

        if (svc.onConnect) svc.onConnect(nport);
    };

    constructor() {
        this.reset();
    }

    // This is factored out as a separate function so we can use it in unit tests
    private reset() {
        this.services.clear();
        browser.runtime.onConnect.addListener(this.listener);
    }

    register(name: string, svc: NanoService<Send, Send>) {
        if (this.services.has(name)) {
            throw new Error(`Service ${name} is already launched`);
        }
        this.services.set(name, svc);
    }
}

export const registry = new SvcRegistry();

export class Port<S extends Send, R extends Send>
    implements NanoPort<S, R>
{
    static connect<MM extends Send, PM extends Send>(
        name: string
    ): Port<MM, PM> {
        return new Port(browser.runtime.connect(undefined, {name}));
    }

    defaultTimeoutMS = 2000;

    onDisconnect?: (port: NanoPort<S, R>) => void;
    onRequest?: (msg: R) => Promise<S>;
    onNotify?: (msg: R) => void;

    get error(): undefined | {message?: string} { return this.port.error; }

    private port: RTPort;
    private pending: Map<string, PendingMsg<R>> = new Map();

    constructor(port: RTPort) {
        this.port = port;

        this.port.onDisconnect.addListener(() => {
            this._flushPendingOnDisconnect();
            if (this.onDisconnect) this.onDisconnect(this);
        });

        this.port.onMessage.addListener(((msg: Envelope<R>) => {
            if (! msg) return;
            if ('tag' in msg) {
                if ('request' in msg) {
                    this._handleRequest(msg);

                } else if ('response' in msg || 'error' in msg) {
                    this._handleResponse(msg);
                }

            } else if ('notify' in msg) {
                if (this.onNotify) this.onNotify(msg.notify as R);
                else if (this.onRequest) this.onRequest(msg.notify as R);
            }
        }) as (msg: object) => void);
    }

    disconnect() {
        this.port.disconnect();
        this._flushPendingOnDisconnect();
    }

    request(request: S, options?: {timeout_ms?: number}): Promise<R> {
        return new Promise((resolve, reject) => {
            let tag = makeRandomString(4);
            while (this.pending.has(tag)) tag = makeRandomString(4);

            this.port.postMessage({tag, request} as RequestEnvelope<S>);

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

    notify(notify: S) {
        try {
            this.port.postMessage({notify} as NotifyEnvelope<S>);
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

    private async _handleRequest(msg: RequestEnvelope<R>) {
        let res: Response<S>;

        try {
            if (! this.onRequest) await not_implemented();
            res = {response: await this.onRequest!(msg.request as R)};

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

        const resmsg: ResponseEnvelope<S> = {tag: msg.tag, ...res};

        try {
            this.port.postMessage(resmsg);
        } catch (e) {
            // If the other side becomes disconnected before we can send the
            // reply, just drop it.  We should get a disconnection event later.
        }
    }

    private _handleResponse(msg: ResponseEnvelope<R>) {
        const handler = this.pending.get(msg.tag);
        if (! handler) return;

        if ('response' in msg) {
            handler.resolve(msg.response);
        } else {
            handler.reject(new RemoteNanoError(msg.error));
        }
    }
}

type PendingMsg<M extends Send> = {
    resolve: (msg: M) => void,
    reject: (err: Error) => void,
    timeout_id: ReturnType<typeof setTimeout>,
};

type RTPort = browser.runtime.Port;

function not_implemented(): Promise<any> {
    const e = new Error('No request handler defined');
    e.name = 'NotImplemented';
    return Promise.reject(e);
}
