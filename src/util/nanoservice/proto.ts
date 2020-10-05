// Send must be serializable to JSON.  As a small concession to JS, we allow
// undefined... but callers should be aware that any explicit undefined will
// be omitted when sent.
export type Send = undefined | null | boolean | number | string
                 | {[k: string]: Send}
                 | Send[];

// The NanoService communication protocol.
export type Envelope<M extends Send> =
    NotifyEnvelope<M> | RequestEnvelope<M> | ResponseEnvelope<M>;

export type NotifyEnvelope<M extends Send> = {notify: M};

export type RequestEnvelope<M extends Send> = {tag: string, request: M};

export type ResponseEnvelope<M extends Send> = {tag: string} & Response<M>;
export type Response<M extends Send> = {response: M} | {error: ErrorResponse};

export type ErrorResponse = {
    name: string,
    message?: string,
    stack?: string,
    data?: Send,
};
