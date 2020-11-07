import {Send, NanoPort} from '../../util/nanoservice';

// The protocol used to communicate between the datastore/cache/client and cache-server.

export type ServicePort<E extends Send> = NanoPort<ClientMsg<E>, ServiceMsg<E>>;
export type ClientPort<E extends Send> = NanoPort<ServiceMsg<E>, ClientMsg<E>>;

// All of the messages that may be sent or received by client or service.
export type ClientMsg<E extends Send> = FetchMessage | UpdateMessage<E>;
export type ServiceMsg<E extends Send> = UpdateMessage<E> | ExpiredMessage;

// Sent by the client to request the service's value for a particular key.  The
// expected response is an EntryMessage.
export type FetchMessage = {
    $type: 'fetch',
    keys: string[],
};

// Can be sent independently by either the client or the service to notify the
// other of update(s), or sent in response to a FetchMessage.
export type UpdateMessage<Entry extends Send> = {
    $type: 'update',
    entries: {key: string, value: Entry}[],
};

export type ExpiredMessage = {
    $type: 'expired',
    keys: string[],
};
