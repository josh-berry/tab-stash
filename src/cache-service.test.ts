import {expect} from 'chai';

import * as events from './mock/events';
import mock_runtime from './mock/browser-runtime';
import mock_indexeddb from './mock/indexeddb';

import {
    ServicePort, ServiceMsg, UpdateMessage, ExpiredMessage, FetchMessage
} from './cache-proto';
import * as NS from './util/nanoservice';

class MockClient {
    port: ServicePort<string>;
    recvd: ServiceMsg<string>[] = [];

    constructor() {
        this.port = NS.connect('cache:test');
        this.port.onNotify = msg => this.recvd.push(msg);
    }

    fetch(keys: string[]) {
        this.port.notify(<FetchMessage>{$type: 'fetch', keys});
    }

    set(entries: {key: string, value: string}[]) {
        this.port.notify(<UpdateMessage<string>>{$type: 'update', entries});
    }

    read(): ServiceMsg<string> {
        if (this.recvd.length <= 0) {
            throw new Error(`Tried to read with no messages in the buffer`);
        }
        return this.recvd.shift()!;
    }
}

describe('cache-service', function() {
    const GC_THRESHOLD = require('./cache-service').GC_THRESHOLD;
    let CacheService = require('./cache-service').CacheService;
    let service: typeof CacheService = undefined!;

    async function reset_service() {
        await service.next_mutation_testonly;
        events.expect_empty();
        service = undefined!;
        delete require.cache[require.resolve('./cache-service')];
        expect(await (<any>indexedDB).databases()).to.deep.include({
            name: 'cache:test', version: 1});

        mock_runtime.reset();
        (<any>NS.registry).reset();
        CacheService = require('./cache-service').CacheService;
        service = await CacheService.start('test');
    }

    async function reset() {
        if (service) await service.next_mutation_testonly;
        service = undefined!;
        delete require.cache[require.resolve('./cache-service')];

        mock_runtime.reset();
        mock_indexeddb.reset();
        (<any>NS.registry).reset();
        CacheService = require('./cache-service').CacheService;
        service = await CacheService.start('test');
    }

    beforeEach(reset);
    afterEach(events.expect_empty);

    describe('storing and fetching entries', function() {
        it('stores entries in the database', async function() {
            const client = new MockClient();
            await events.drain(1); // connection

            client.set([{key: 'foo', value: 'bar'},
                        {key: 'bar', value: 'fred'}]);
            await events.drain(2);

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
            await events.drain(1);

            client.set([{key: 'foo', value: 'bar'}]);
            await events.drain(2);
            expect(client.read()).to.deep.equal(
                {$type: 'update', entries: [{key: 'foo', value: 'bar'}]});

            client.set([{key: 'bar', value: 'fred'}]);
            await events.drain(2);
            expect(client.read()).to.deep.equal(
                {$type: 'update', entries: [{key: 'bar', value: 'fred'}]});

            client.fetch(['foo', 'bar']);
            await events.drain(2);
            expect(client.read()).to.deep.equal(
                {$type: 'update', entries: [{key: 'foo', value: 'bar'},
                                            {key: 'bar', value: 'fred'}]});
        });

        it('resets the generation of accessed entries', async function() {
            const c1 = new MockClient();
            await events.drain(1);
            expect(service.gen_testonly).to.equal(1);

            c1.set([{key: 'foo', value: 'bar'}]);
            await events.drain(2);

            const c2 = new MockClient();
            await events.drain(1);
            await service.next_mutation_testonly;
            expect(service.gen_testonly).to.equal(2);
            expect(await service._db.get('cache', 'foo'))
                .to.deep.equal({key: 'foo', value: 'bar', agen: 1});

            c2.fetch(['foo']);
            await events.drain(2);

            new MockClient();
            await events.drain(1);
            await service.next_mutation_testonly;
            expect(service.gen_testonly).to.equal(3);
            expect(await service._db.get('cache', 'foo'))
                .to.deep.equal({key: 'foo', value: 'bar', agen: 2});
        });

        // It's unclear how to test this given our inability to check for events
        // that never happen. :/
        //
        //it('ignores requests for missing entries');

        it('notifies all clients about entries that were updated',
           async function() {
               const c1 = new MockClient();
               const c2 = new MockClient();
               await events.drain(2);

               c1.set([{key: 'foo', value: 'bar'}]);
               await events.drain(3);

               expect(c1.read()).to.deep.equal(
                   {$type: 'update', entries: [{key: 'foo', value: 'bar'}]});
               expect(c2.read()).to.deep.equal(
                   {$type: 'update', entries: [{key: 'foo', value: 'bar'}]});
           });

        it('batches multiple updates together', async function() {
            const c1 = new MockClient();
            const c2 = new MockClient();
            await events.drain(2);

            c1.set([{key: 'foo', value: 'bar'}]);
            c2.set([{key: 'bar', value: 'baz'}]);
            await events.drain(2);

            const res = {$type: 'update', entries: [
                {key: 'foo', value: 'bar'},
                {key: 'bar', value: 'baz'},
            ]};

            await events.drain(2);
            expect(c1.read()).to.deep.equal(res);
            expect(c2.read()).to.deep.equal(res);
        });
    });

    describe('garbage collection', function() {
        it('increments its generation number for each new client',
           async function() {
               expect(service.gen_testonly).to.equal(0);

               new MockClient();
               await events.drain(1);
               await service.next_mutation_testonly;
               expect(service.gen_testonly).to.equal(1);

               new MockClient();
               await events.drain(1);
               await service.next_mutation_testonly;
               expect(service.gen_testonly).to.equal(2);
           });

        it('batches generation increments if multiple clients connect quickly',
           async function() {
               expect(service.gen_testonly).to.equal(0);

               new MockClient();
               new MockClient();
               await events.drain(2);
               await service.next_mutation_testonly;
               expect(service.gen_testonly).to.equal(1);

               new MockClient();
               new MockClient();
               new MockClient();
               await events.drain(3);
               await service.next_mutation_testonly;
               expect(service.gen_testonly).to.equal(2);
           });

        it('stores its generation number persistently', async function() {
            new MockClient();
            new MockClient();
            await events.drain(2);
            await service.next_mutation_testonly;

            expect(await service._db.get('options', 'generation'), 'initial')
                .to.equal(1);
            expect(service.gen_testonly).to.equal(1);

            new MockClient();
            await events.drain(1);
            await service.next_mutation_testonly;

            expect(await service._db.get('options', 'generation'), 'initial')
                .to.equal(2);
            expect(service.gen_testonly).to.equal(2);

            await reset_service();
            expect(await service._db.get('options', 'generation'), 'post-reset')
                .to.equal(2);
            expect(service.gen_testonly).to.equal(2);
        });

        it('keeps unused entries around for at least two generations',
           async function() {
               const c1 = new MockClient();
               await events.drain(1);

               c1.set([{key: 'foo', value: 'bar'}]);
               await events.drain(2);

               new MockClient();
               await events.drain(1);
               await service.next_mutation_testonly;
               expect(await service._db.get('cache', 'foo')).to.deep.equal({
                   key: 'foo',
                   value: 'bar',
                   agen: 1,
               });

               new MockClient();
               await events.drain(1);
               await service.next_mutation_testonly;
               expect(await service._db.get('cache', 'foo')).to.deep.equal({
                   key: 'foo',
                   value: 'bar',
                   agen: 1,
               });
           });

        it('evicts unused entries eventually', async function() {
            const c = new MockClient();
            await events.drain(1);
            c.set([{key: 'foo', value: 'bar'},
                   {key: 'xtra', value: 'crunchy'}]);
            await events.drain(2);
            await service.next_mutation_testonly;

            // Assumes GC_THRESHOLD == 8
            for (let i = 0; i < (GC_THRESHOLD - 1); ++i) {
                new MockClient();
                await events.drain(1);
                await service.next_mutation_testonly;
                expect(service.gen_testonly, `iteration ${i}`).to.equal(i+2);
                expect(await service._db.get('cache', 'foo'), `iteration ${i}`)
                    .to.deep.equal({key: 'foo', value: 'bar', agen: 1});
                expect(await service._db.get('cache', 'xtra'), `iteration ${i}`)
                    .to.deep.equal({key: 'xtra', value: 'crunchy', agen: 1});
            }

            new MockClient();
            await events.drain(1);
            await service.next_mutation_testonly;
            await events.drain(GC_THRESHOLD + 1); // eviction notices
            expect(await service._db.get('cache', 'foo')).to.be.undefined;
            expect(await service._db.get('cache', 'xtra')).to.be.undefined;
            expect(await service._db.get('options', 'generation'))
                .to.equal(GC_THRESHOLD / 2);
        });

        it('notifies all clients about entries that have expired',
           async function() {
               const c1 = new MockClient();
               await events.drain(1);

               c1.set([{key: 'foo', value: 'bar'},
                       {key: 'extra', value: 'crunchy'}]);
               await events.drain(2);
               expect(c1.read()).to.deep.equal(
                   {$type: 'update', entries: [
                       {key: 'foo', value: 'bar'},
                       {key: 'extra', value: 'crunchy'}]});

               service.force_gc_on_next_mutation_testonly();

               const c2 = new MockClient();
               await events.drain(1);
               await service.next_mutation_testonly;
               await events.drain(2); // expiration notices

               const c1exp = c1.read() as ExpiredMessage;
               const c2exp = c2.read() as ExpiredMessage;
               for (const exp of [c1exp, c2exp]) {
                   expect(exp.$type).to.equal('expired');
                   expect(new Set(exp.keys))
                       .to.deep.equal(new Set(['foo', 'extra']));
               }
           });

        it('handles updates and GC at the same time', async function() {
            const c1 = new MockClient();
            await events.drain(1);
            await service.next_mutation_testonly;

            c1.set([{key: 'foo', value: 'bar'}]);
            await events.drain(2);
            expect(c1.read()).to.deep.equal({$type: 'update', entries: [
                {key: 'foo', value: 'bar'}]});

            service.force_gc_on_next_mutation_testonly();

            c1.set([{key: 'foo', value: 'cronch'}]);
            await events.drain(2);
            expect(c1.read()).to.deep.equal({$type: 'update', entries: [
                {key: 'foo', value: 'cronch'}]});
        });

        it('batches updates and evictions together', async function() {
            const c1 = new MockClient();
            await events.drain(1);
            await service.next_mutation_testonly;

            c1.set([{key: 'foo', value: 'bar'},
                    {key: 'bar', value: 'fred'},
                    {key: 'extra', value: 'crunchy'}]);
            await events.drain(2);

            expect(c1.read()).to.deep.equal(
                {$type: 'update', entries: [
                    {key: 'foo', value: 'bar'},
                    {key: 'bar', value: 'fred'},
                    {key: 'extra', value: 'crunchy'}]});

            c1.set([{key: 'super', value: 'spicy'},
                    {key: 'extra', value: 'crispy'}]);
            const c2 = new MockClient();
            service.force_gc_on_next_mutation_testonly();
            await events.drain(6); // connect + 1 update + 2 notices + 2 evicts

            for (const c of [c1, c2]) {
                const expired = new Set<string>();
                const updated = new Map<string, string>();
                expect(c.recvd.length).to.equal(2);
                for (const msg of c.recvd) {
                    switch (msg.$type) {
                        case 'expired':
                            for (const k of msg.keys) {
                                expect(expired.has(k), k).to.be.false;
                                expired.add(k);
                            }
                            break;
                        case 'update':
                            for (const e of msg.entries) {
                                expect(updated.has(e.key), e.key).to.be.false;
                                updated.set(e.key, e.value);
                            }
                            break;
                        default:
                            expect((<any>msg).$type).to.satisfy(
                                (x: string) => x == 'expired' || x == 'update');
                    }
                }
                expect(expired).to.deep.equal(new Set(['foo', 'bar']));
                if (c == c2) continue;
                expect(updated).to.deep.equal(new Map([['super', 'spicy'],
                                                       ['extra', 'crispy']]));
            }
        });
    });
});
