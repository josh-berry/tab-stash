import {Send, NanoPort} from '../../util/nanoservice';

// The protocol used to communicate between client and service.

export type Entry<K extends Key, V extends Value> = {key: K, value: V};
export type Key = string | number;
export type Value = Send;

export type ServicePort<K extends Key, V extends Value> =
    NanoPort<ClientMsg<K, V>, ServiceMsg<K, V>>;
export type ClientPort<K extends Key, V extends Value> =
    NanoPort<ServiceMsg<K, V>, ClientMsg<K, V>>;

// All of the messages that may be sent or received by client or service.
export type ClientMsg<K extends Key, V extends Value> =
    GetMessage<K, V> | GetStartingFromMessage<K, V> | GetEndingAtMessage<K, V> |
    SetMessage<K, V> | DeleteMessage<K, V> | DeleteAllMessage<K, V> |
    null;
export type ServiceMsg<K extends Key, V extends Value> =
    SetMessage<K, V> | DeleteMessage<K, V> |
    null;

// Request for one or more values with known keys.  Only sent from client to
// service.  Response is a SetMessage with all the entries that were found.
export type GetMessage<K extends Key, _V extends Value> = {
    $type: 'get',
    keys: K[],
};

// Retrieve multiple values when the keys aren't known, starting with values >
// bound (or the first value, if bound isn't specified).  Only sent from client
// to service.  Response is a SetMessage with the requested key/value pairs.
//
// Entries are returned in ascending key order.
export type GetStartingFromMessage<K extends Key, _V extends Value> = {
    $type: 'getStartingFrom',

    // If bound is undefined, returns entries starting from the smallest key.
    // Otherwise returns entries with keys > /bound/.
    bound: K | undefined,

    // How many entries to return.
    limit: number,
};

// Retrieve multiple values when the keys aren't known, starting with values <
// bound (or the last value, if bound isn't specified).  Only sent from client
// to service.  Response is a SetMessage with the requested key/value pairs.
//
// Entries are returned in descending key order.
export type GetEndingAtMessage<K extends Key, _V extends Value> = {
    $type: 'getEndingAt',

    // If bound is undefined, returns entries starting from the smallest key.
    // Otherwise returns entries with keys > /bound/.
    bound: K | undefined,

    // How many entries to return.
    limit: number,
};

// Sent by a client to set one or more values.  Sent by the service in response
// to a Get, or in the event of an update by another client.  Service replies
// with `undefined`.
export type SetMessage<K extends Key, V extends Value> = {
    $type: 'set',
    entries: Entry<K, V>[],
};

// Sent by a client to delete one or more values.  Sent by the service in
// response to a Delete or in the event of a delete by another client.  Response
// is `undefined`--clients will be sent separate notifications for deleted keys.
export type DeleteMessage<K extends Key, _V extends Value> = {
    $type: 'delete',
    keys: K[],
};

// Sent by a client to request deletion of all values.  Response is
// `undefined`--clients will be sent separate notifications for specific keys
// that
// are deleted.
export type DeleteAllMessage<_K extends Key, _V extends Value> = {
    $type: 'deleteAll',
};
