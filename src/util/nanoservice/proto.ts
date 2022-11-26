// Send must be serializable to JSON.  As a small concession to JS, we allow
// undefined inside objects... but callers should be aware that any explicit
// undefined will be omitted when sent.
//
// Note that we do not allow "top-level" Send objects to be null, because that
// would break the underlying nanoservice protocol, which expects to be able to
// assign Send values to specific fields inside the messages it sends.
// Assigning `undefined` to such a field would make it disappear.
export type Send =
  | null
  | boolean
  | number
  | string
  | {[k: string]: Send | undefined}
  | Send[];

// The NanoService communication protocol.
export type Envelope<M extends Send> =
  | NotifyEnvelope<M>
  | RequestEnvelope<M>
  | ResponseEnvelope<M>;

export type NotifyEnvelope<M extends Send> = {notify: M};

export type RequestEnvelope<M extends Send> = {tag: string; request: M};

export type ResponseEnvelope<M extends Send> = {tag: string} & Response<M>;
export type Response<M extends Send> = {response: M} | {error: ErrorResponse};

export type ErrorResponse = {
  name: string;
  message?: string;
  stack?: string;
  data?: Send;
};
