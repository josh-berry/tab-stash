import {expect} from 'chai';
import {openDB} from 'idb';

import * as NS from '../nanoservice';
import Service from './service';
import mock_indexeddb from '../../mock/indexeddb';

import {tests} from './index.test';
import * as P from './proto';

async function kvs_factory(): Promise<Service<string, string>> {
    mock_indexeddb.reset();
    NS.registry.reset_testonly();
    const db = await openDB('test', 1, {
        upgrade(db, oldVersion, newVersion, txn) {
            db.createObjectStore('test');
        }
    });
    return new Service(db, 'test');
}

describe('util/kvs/service', function() {
    describe('implements KeyValueStore', () => tests(kvs_factory));

    describe('broadcasts object updates to clients', async() => {
        let client: MockPort;
        let svc: Service<string, string>;

        beforeEach(async() => {
            client = new MockPort();
            svc = await kvs_factory();
            svc.onConnect(client);
        });

        it('sends updates for new objects', async() => {
            await svc.set([{key: 'a', value: 'b'}]);
            expect(client.received).to.deep.equal([
                {$type: 'set', entries: [{key: 'a', value: 'b'}]}
            ]);
        });

        it('sends updates for multiple new objects at once', async() => {
            await svc.set([{key: 'a', value: 'b'}, {key: 'b', value: 'c'}]);
            expect(client.received).to.deep.equal([
                {$type: 'set', entries: [
                    {key: 'a', value: 'b'}, {key: 'b', value: 'c'}]}]);
        });

        it('sends updates for changed objects', async() => {
            await svc.set([{key: 'a', value: 'a'}]);
            await svc.set([{key: 'a', value: 'alison'}]);
            expect(client.received).to.deep.equal([
                {$type: 'set', entries: [{key: 'a', value: 'a'}]},
                {$type: 'set', entries: [{key: 'a', value: 'alison'}]}
            ]);
        });

        it('sends updates for deleted objects', async() => {
            await svc.set([{key: 'a', value: 'a'}]);
            await svc.delete(['a']);
            expect(client.received).to.deep.equal([
                {$type: 'set', entries: [{key: 'a', value: 'a'}]},
                {$type: 'delete', keys: ['a']},
            ]);
        });

        it('sends updates for each object when deleting everything', async() => {
            await svc.set([{key: 'a', value: 'a'}]);
            await svc.set([{key: 'b', value: 'b'}]);
            await svc.deleteAll();
            expect(client.received).to.deep.equal([
                {$type: 'set', entries: [{key: 'a', value: 'a'}]},
                {$type: 'set', entries: [{key: 'b', value: 'b'}]},
                {$type: 'delete', keys: ['a', 'b']},
            ]);
        });
    });
});

// Consider using a mocking library if this gets to be too much
class MockPort implements P.ClientPort<string, string> {
    received: P.ClientMsg<string, string>[] = [];

    request(msg: P.ClientMsg<string, string>): Promise<P.ServiceMsg<string, string>> {
        throw new Error(`Services shouldn't make requests: ${msg}`);
    }
    notify(msg: P.ClientMsg<string, string>) {
        // We do a round-trip thru JSON to ensure nothing else is holding on to
        // references to the message we received...
        this.received.push(JSON.parse(JSON.stringify(msg)));
    }
    disconnect() {}
}
