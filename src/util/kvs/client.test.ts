import Client from './client';
import * as Proto from './proto';

import {tests} from './index.test';

async function kvs_factory(): Promise<Client<string, string>> {
    return new Client(new MockServicePort());
}

describe('util/kvs/client', function() {
    describe('implements KeyValueStore', () => tests(kvs_factory));
});

class MockServicePort implements Proto.ServicePort<string, string> {
    onNotify = (_: Proto.ServiceMsg<string, string>) => undefined;
    entries = new Map<string, string>();

    async request(
        msg: Proto.ClientMsg<string, string>
    ): Promise<Proto.ServiceMsg<string, string>> {
        switch (msg?.$type) {
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

            case 'set':
                for (const {key, value} of msg.entries) this.entries.set(key, value);
                const res = {
                    $type: 'set',
                    entries: copy(msg.entries),
                } as const;
                this.onNotify(res);
                return undefined;

            case 'delete':
                const deleted = [];
                for (const k of msg.keys) {
                    if (this.entries.delete(k)) deleted.push(k);
                }
                this.onNotify({$type: 'delete', keys: deleted});
                return undefined;

            case 'deleteAll':
                const all_deleted = [];
                for (const k of this.entries.keys()) {
                    if (this.entries.delete(k)) all_deleted.push(k);
                }
                this.onNotify({$type: 'delete', keys: all_deleted});
                return undefined;
        }
    }

    notify(msg: Proto.ClientMsg<string, string>) {}

    disconnect() {}
}

const copy = (x: any) => JSON.parse(JSON.stringify(x));
