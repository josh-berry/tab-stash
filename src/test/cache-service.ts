import {expect} from 'chai';

import mock_runtime from './mock/browser-runtime';
import mock_indexeddb from './mock/indexeddb';

import {
    Message, EntryMessage, /*ExpiringMessage,*/ FetchMessage
} from '../cache-proto';

class MockClient {
    port: browser.runtime.Port;
    recvd: Message<string>[] = [];
    resolve?: (m: Message<string>) => void;

    constructor() {
        this.port = browser.runtime.connect(undefined, {name: 'cache:test'});
        this.port.onMessage.addListener(msg => {
            if (this.resolve) {
                this.resolve(<Message<string>>msg);
                this.resolve = undefined;
            } else {
                this.recvd.push(<Message<string>>msg);
            }
        });
    }

    fetch(key: string) {
        this.port.postMessage(<FetchMessage>{type: 'fetch', key});
    }

    set(key: string, value: string) {
        this.port.postMessage(
                <EntryMessage<string>>{type: 'entry', key, value});
    }

    read(): Promise<Message<string>> {
        if (this.recvd.length > 0) {
            return Promise.resolve(this.recvd.pop()!);
        } else if (this.resolve) {
            throw `Tried to read multiple times`;
        } else {
            return new Promise(resolve => {
                this.resolve = resolve;
            });
        }
    }
}

async function drain() {
    while (await mock_runtime.drain() > 0) {
        await mock_indexeddb.drain();
    }
}

describe('cache-service', function() {
    let CacheService = require('../cache-service').CacheService;
    let service: typeof CacheService = undefined!;

    async function reset_service() {
        service = undefined!;
        delete require.cache[require.resolve('../cache-service')];
        await drain();
        expect(await (<any>indexedDB).databases()).to.deep.include({
            name: 'cache:test', version: 1});
        CacheService = require('../cache-service').CacheService;
        service = await CacheService.start('test');
    }

    async function reset() {
        service = undefined!;
        delete require.cache[require.resolve('../cache-service')];

        await drain();

        mock_runtime.reset();
        mock_indexeddb.reset();
        CacheService = require('../cache-service').CacheService;
        service = await CacheService.start('test');
    }

    beforeEach(reset);

    describe('storing and fetching entries', function() {
        it('stores entries in the database', async function() {
            const client = new MockClient();
            client.set('foo', 'bar');
            client.set('bar', 'fred');
            await drain();

            expect(await service._db.get('cache', 'foo')).to.deep.equal({
                key: 'foo',
                value: 'bar',
                agen: 1,
            });
            expect(await service._db.get('cache', 'bar')).to.deep.equal({
                key: 'bar',
                value: 'fred',
                agen: 1,
            });
        });

        it('retrieves entries that were previously stored', async function() {
            const client = new MockClient();
            client.set('foo', 'bar');
            expect(await client.read()).to.deep.equal(
                {type: 'entry', key: 'foo', value: 'bar'});

            client.set('bar', 'fred');
            expect(await client.read()).to.deep.equal(
                {type: 'entry', key: 'bar', value: 'fred'});

            client.fetch('foo');
            expect(await client.read()).to.deep.equal(
                {type: 'entry', key: 'foo', value: 'bar'});

            client.fetch('bar');
            expect(await client.read()).to.deep.equal(
                {type: 'entry', key: 'bar', value: 'fred'});
        });

        // It's unclear how to test this given our inability to check for events
        // that never happen. :/
        //
        //it('ignores requests for missing entries');

        it('notifies all clients about entries that were updated',
           async function() {
               const c1 = new MockClient();
               const c2 = new MockClient();

               c1.set('foo', 'bar');
               expect(await c1.read()).to.deep.equal(
                   {type: 'entry', key: 'foo', value: 'bar'});
               expect(await c2.read()).to.deep.equal(
                   {type: 'entry', key: 'foo', value: 'bar'});
           });

    });

    describe('garbage collection', function() {
        it('increments its generation number for each new client',
           async function() {
               expect(service.generation).to.equal(0);

               new MockClient();
               await drain();
               expect(service.generation).to.equal(1);

               new MockClient();
               await drain();
               expect(service.generation).to.equal(2);
           });

        it('stores its generation number persistently', async function() {
            new MockClient();
            new MockClient();
            await drain();

            expect(await service._db.get('options', 'generation'), 'initial')
                .to.equal(2);
            expect(service.generation).to.equal(2);

            await reset_service();
            expect(await service._db.get('options', 'generation'), 'post-reset')
                .to.equal(2);
            expect(service.generation).to.equal(2);
        });

        it('keeps unused entries around for at least two generations',
           async function() {
               const c1 = new MockClient();
               c1.set('foo', 'bar');
               await drain();

               new MockClient();
               await drain();
               expect(await service._db.get('cache', 'foo')).to.deep.equal({
                   key: 'foo',
                   value: 'bar',
                   agen: 1,
               });

               new MockClient();
               await drain();
               expect(await service._db.get('cache', 'foo')).to.deep.equal({
                   key: 'foo',
                   value: 'bar',
                   agen: 1,
               });
           });

        it('evicts unused entries eventually', async function() {
            const c = new MockClient();
            c.set('foo', 'bar');
            await drain();

            // Assumes GC_THRESHOLD == 16
            for (let i = 0; i < 15; ++i) {
                new MockClient();
                await drain();
                expect(service.generation, `iteration ${i}`).to.equal(i+2);
                expect(await service._db.get('cache', 'foo'), `iteration ${i}`)
                    .to.deep.equal({key: 'foo', value: 'bar', agen: 1});
            }

            new MockClient();
            await drain();
            expect(await service._db.get('cache', 'foo')).to.be.undefined;
        });

        it('notifies all clients about entries that have expired',
           async function() {
               const expiring = {type: 'expiring', key: 'foo'};
               const c1 = new MockClient();
               c1.set('foo', 'bar');
               await drain();

               for (let i = 0; i < 15; ++i) {
                   new MockClient();
                   await drain();
               }

               const c2 = new MockClient();
               await drain();
               expect(await c1.read()).to.deep.equal(expiring);
               expect(await c2.read()).to.deep.equal(expiring);
           });
    });
});
