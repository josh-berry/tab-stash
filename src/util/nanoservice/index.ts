import * as Proto from './proto';
import * as Live from './live';

export type Send = Proto.Send;
export const registry = Live.registry;

export function listen<S extends Send, R extends Send>(
    name: string,
    svc: NanoService<S, R>,
) {
    Live.registry.register(name, svc as unknown as NanoService<Send, Send>);
}

export function connect<S extends Send, R extends Send>(
    name: string
): NanoPort<S, R> {
    return Live.Port.connect(name);
}

export interface NanoService<C extends Send, S extends Send> {
    onConnect?: (port: NanoPort<S, C>) => void;
    onDisconnect?: (port: NanoPort<S, C>) => void;
    onRequest?: (port: NanoPort<S, C>, msg: C) => Promise<S>;
    onNotify?: (port: NanoPort<S, C>, msg: C) => void;
}

export interface NanoPort<S extends Send, R extends Send> {
    defaultTimeoutMS?: number;

    onDisconnect?: (port: NanoPort<S, R>) => void;
    onRequest?: (msg: R) => Promise<S>;
    onNotify?: (msg: R) => void;

    readonly error?: {message?: string};

    request(msg: S, options?: {timeout_ms?: number}): Promise<R>;
    notify(msg: S): void;
    disconnect(): void;
}

export class RemoteNanoError extends Error {
    private readonly remote: Proto.ErrorResponse;

    constructor(remote: Proto.ErrorResponse) {
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
        super(`Request timeout: ${JSON.stringify(request)}`);
        this.name = 'NanoTimeoutError';
        this.request = request;
    }
}
