// This must come first because of dependencies on mocks which must be loaded
// before trying to load the "live" code.
import {tests} from './index.test';

import Client from './client';
import * as Proto from './proto';

async function kvs_factory(): Promise<Client<string, string>> {
    return new Client(new MockServicePort());
}

describe('datastore/kvs/client', function() {
    describe('implements KeyValueStore', () => tests(kvs_factory));
});

// XXX Refactor me into something that just composes MemoryKVS (which was added
// after this code was written) with something that responds to KVS service
// messages.  Or to put it another way, split kvs/service.ts into the IndexedDB
// KVS and the thing that forwards messages/events to/from IndexedDB KVS.
class MockServicePort implements Proto.ServicePort<string, string> {
    readonly name: string = '';

    // istanbul ignore next
    onNotify = (_: Proto.ServiceMsg<string, string>) => undefined;

    entries = new Map<string, string>();

    async request(
        msg: Proto.ClientMsg<string, string>
    ): Promise<Proto.ServiceMsg<string, string>> {
        // istanbul ignore next
        if (! msg) return null;

        switch (msg.$type) {
            case 'get':
                const entries: Proto.Entry<string, string>[] = [];
                for (const key of msg.keys) {
                    const v = this.entries.get(key);
                    if (v) entries.push({key, value: copy(v)});
                }
                return {$type: 'set', entries};

            case 'getStartingFrom':
                let keys = Array.from(this.entries.keys()).sort();
                if (msg.bound !== undefined) keys = keys.filter(x => x > msg.bound!);
                return {
                    $type: 'set',
                    entries: keys.slice(0, msg.limit)
                        .map(key => ({key, value: copy(this.entries.get(key))})),
                };

            case 'getEndingAt':
                let rkeys = Array.from(this.entries.keys()).sort().reverse();
                if (msg.bound !== undefined) rkeys = rkeys.filter(x => x < msg.bound!);
                return {
                    $type: 'set',
                    entries: rkeys.slice(0, msg.limit)
                        .map(key => ({key, value: copy(this.entries.get(key))})),
                };

            case 'set':
                for (const {key, value} of msg.entries) this.entries.set(key, value);
                const res = {
                    $type: 'set',
                    entries: copy(msg.entries),
                } as const;
                if (res.entries.length > 0) this.onNotify(res);
                return null;

            case 'delete':
                const deleted = [];
                for (const k of msg.keys) {
                    if (this.entries.delete(k)) deleted.push(k);
                }
                if (deleted.length > 0) {
                    this.onNotify({$type: 'delete', keys: deleted});
                }
                return null;

            case 'deleteAll':
                const all_deleted = [];
                for (const k of this.entries.keys()) {
                    this.entries.delete(k);
                    all_deleted.push(k);
                }
                this.onNotify({$type: 'delete', keys: all_deleted});
                return null;
        }
    }

    // istanbul ignore next
    notify(msg: Proto.ClientMsg<string, string>) {}

    // istanbul ignore next
    disconnect() {}
}

const copy = (x: any) => JSON.parse(JSON.stringify(x));
