import {expect} from 'chai';

// Needed because the 'util' import below tries to poke at browser.runtime
import '../../mock/browser/runtime';

import {KeyValueStore, KVSCache} from '.';
import MemoryKVS from './memory';

import * as events from '../../mock/events';

/** Behavioral tests which are common to both client and service.
 *
 * These are "abstract" tests in that they are run against a concrete
 * implementation of the KVS.  So the tests here are imported and reused in both
 * client and service tests. */
export function tests(kvs_factory: () => Promise<KeyValueStore<string, string>>) {
    let kvs: KeyValueStore<string, string>;

    beforeEach(async () => {
        kvs = undefined as any;
        kvs = await kvs_factory();
    });

    async function setDefaults() {
        await kvs.set([
            {key: 'c', value: 'christine'},
            {key: 'a', value: 'alice'},
            {key: 'b', value: 'bob'},
            {key: 'd', value: 'derek'},
        ]);
        await events.next(kvs.onSet);
    }

    describe('stores and updates entries', () => {
        it('no entries', async() => {
            await kvs.set([]);
        });

        it('creates single entries', async() => {
            const values = [{key: 'a', value: 'alice'}];

            await kvs.set(JSON.parse(JSON.stringify(values)));
            expect(await events.next(kvs.onSet)).to.deep.equal([values]);
            expect(await kvs.get(['a'])).to.deep.equal(values);
        });

        it('updates single entries', async() => {
            const values = [{key: 'a', value: 'alice'}];

            await kvs.set(JSON.parse(JSON.stringify(values)));
            expect(await events.next(kvs.onSet)).to.deep.equal([values]);
            expect(await kvs.get(['a'])).to.deep.equal(values);

            await kvs.set([{key: 'a', value: 'alison'}]);
            expect(await events.next(kvs.onSet))
                .to.deep.equal([[{key: 'a', value: 'alison'}]]);
            expect(await kvs.get(['a']))
                .to.deep.equal([{key: 'a', value: 'alison'}]);
        });

        it('stores and updates multiple entries at once', async() => {
            await setDefaults();
            await kvs.set([
                {key: 'a', value: 'alison'},
                {key: 'e', value: 'ethel'},
            ]);
            expect(await events.next(kvs.onSet)).to.deep.equal([[
                {key: 'a', value: 'alison'},
                {key: 'e', value: 'ethel'},
            ]]);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'a', value: 'alison'},
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
                {key: 'e', value: 'ethel'},
            ]);
        });
    });

    describe('retrieves blocks of entries in ascending key order', () => {
        beforeEach(setDefaults);
        it('starting at the beginning', async() =>
            expect(await kvs.getStartingFrom(undefined, 2)).to.deep.equal([
                {key: 'a', value: 'alice'},
                {key: 'b', value: 'bob'},
            ]));
        it('before the beginning', async() =>
            expect(await kvs.getStartingFrom('1', 2)).to.deep.equal([
                {key: 'a', value: 'alice'},
                {key: 'b', value: 'bob'},
            ]));
        it('in the middle', async() =>
            expect(await kvs.getStartingFrom('a', 2)).to.deep.equal([
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
            ]));
        it('in the middle but the bound is absent', async() =>
            expect(await kvs.getStartingFrom('ab', 2)).to.deep.equal([
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
            ]));
        it('near the end', async() =>
            expect(await kvs.getStartingFrom('c', 2)).to.deep.equal([
                {key: 'd', value: 'derek'},
            ]));
        it('past the end', async() =>
            expect(await kvs.getStartingFrom('d', 2)).to.deep.equal([]));
        it('way past the end', async() =>
            expect(await kvs.getStartingFrom('e', 2)).to.deep.equal([]));
        it('all entries via iterator', async() =>
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'a', value: 'alice'},
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]));
    });

    describe('retrieves blocks of entries in descending key order', () => {
        beforeEach(setDefaults);
        it('starting at the end', async() =>
            expect(await kvs.getEndingAt(undefined, 2)).to.deep.equal([
                {key: 'd', value: 'derek'},
                {key: 'c', value: 'christine'},
            ]));
        it('after the end', async() =>
            expect(await kvs.getEndingAt('e', 2)).to.deep.equal([
                {key: 'd', value: 'derek'},
                {key: 'c', value: 'christine'},
            ]));
        it('in the middle', async() =>
            expect(await kvs.getEndingAt('d', 2)).to.deep.equal([
                {key: 'c', value: 'christine'},
                {key: 'b', value: 'bob'},
            ]));
        it('in the middle but the bound is absent', async() =>
            expect(await kvs.getEndingAt('cd', 2)).to.deep.equal([
                {key: 'c', value: 'christine'},
                {key: 'b', value: 'bob'},
            ]));
        it('near the beginning', async() =>
            expect(await kvs.getEndingAt('b', 2)).to.deep.equal([
                {key: 'a', value: 'alice'},
            ]));
        it('before the beginning', async() =>
            expect(await kvs.getEndingAt('a', 2)).to.deep.equal([]));
        it('way before the beginning', async() =>
            expect(await kvs.getEndingAt('1', 2)).to.deep.equal([]));
        it('all entries via iterator', async() =>
            expect(await collect(kvs.listReverse())).to.deep.equal([
                {key: 'd', value: 'derek'},
                {key: 'c', value: 'christine'},
                {key: 'b', value: 'bob'},
                {key: 'a', value: 'alice'},
            ]));
    });

    describe('deletes...', () => {
        beforeEach(setDefaults);

        it('...no entries', async() => {
            await kvs.delete([]);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'a', value: 'alice'},
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]);
        });

        it('...single entries', async() => {
            await kvs.delete(['a']);
            expect(await events.next(kvs.onDelete)).to.deep.equal([['a']]);
            expect(await kvs.get(['a'])).to.deep.equal([]);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]);
        });

        it('...entries which do not exist', async() => {
            await kvs.delete(['0']);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'a', value: 'alice'},
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]);
            await kvs.delete(['e']);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'a', value: 'alice'},
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]);
        });

        it('...multiple entries', async() => {
            await kvs.delete(['a', 'b']);
            expect(await events.next(kvs.onDelete)).to.deep.equal([['a', 'b']]);
            expect(await kvs.get(['a', 'b'])).to.deep.equal([]);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]);
        });

        it('...all entries', async() => {
            await kvs.deleteAll();
            const deleted = (await events.next(kvs.onDelete))[0];
            expect(new Set(deleted)).to.deep.equal(new Set(['a', 'b', 'c', 'd']));
            expect(await kvs.get(['a'])).to.deep.equal([]);
            expect(await collect(kvs.list())).to.deep.equal([]);
        });

        it('...all entries in a very large database', async() => {
            const items = new Set<string>(['a', 'b', 'c', 'd']);
            for (let k = 0; k < 1000; ++k) {
                await kvs.set([{key: `${k}`, value: `${k}`}]);
                await events.next(kvs.onSet);
                items.add(`${k}`);
            }
            await kvs.deleteAll();
            while (items.size > 0) {
                const deleted = await events.next(kvs.onDelete);
                for (const k of deleted[0]) {
                    expect(items.has(k)).to.be.true;
                    items.delete(k);
                }
            }
        });
    });
}

describe('datastore/kvs', () => {
    describe('KVSCache', () => {
        let kvs: MemoryKVS<string, string>;
        let cache: KVSCache<string, string>;

        beforeEach(() => {
            kvs = new MemoryKVS('test');
            cache = new KVSCache(kvs);
        });

        it('caches content locally and flushes it asynchronously', async () => {
            cache.set('key', 'value');
            cache.set('a', 'b');
            expect(kvs.data.get('key')).to.be.undefined;
            expect(kvs.data.get('a')).to.be.undefined;
            await cache.sync();
            await events.next(kvs.onSet);
            expect(kvs.data.get('key')).to.deep.equal('value');
            expect(kvs.data.get('a')).to.deep.equal('b');
        });

        it('fetches already-existing objects in the cache', async () => {
            kvs.data.set('a', 'b');
            kvs.data.set('b', 'c');
            const a = cache.get('a');
            const b = cache.get('b')
            expect(a.value).to.be.null;
            expect(b.value).to.be.null;

            await cache.sync();
            expect(a.value).to.deep.equal('b');
            expect(b.value).to.deep.equal('c');
        });

        it('returns the same object when get() is called twice', async () => {
            kvs.data.set('a', 'b');
            const a = cache.get('a');
            expect(a.value).to.be.null;

            await cache.sync();
            expect(a.value).to.deep.equal('b');
            expect(a).to.equal(cache.get('a'));
        });

        it('updates objects returned via get() previously', async () => {
            const a = cache.get('a');
            expect(a.value).to.be.null;

            cache.set('a', 'b');
            expect(a.value).to.equal('b');
            await events.next(kvs.onSet);
        });

        it("loads content it doesn't know about from the KVS", async () => {
            // Blatantly breaking the rule in memory.ts because we don't want
            // events to fire
            kvs.data.set('a', 'b');
            const a = cache.get('a');
            expect(a.value).to.be.null;
            await cache.sync();
            expect(a.value).to.deep.equal('b');
        });

        it('applies updates from the KVS to objects in the cache', async () => {
            const a = cache.get('a');
            expect(a.value).to.be.null;

            await kvs.set([{key: 'a', value: 'b'}]);
            await events.next(kvs.onSet);
            expect(a.value).to.equal('b');
        });

        it('deletes and resurrects objects in the cache', async () => {
            const a = cache.get('a');
            cache.set('a', 'b');
            expect(a.value).to.deep.equal('b');

            await cache.sync();
            await events.next(kvs.onSet);
            expect(kvs.data.get('a')).to.equal('b');

            await kvs.delete(['a']);
            await events.next(kvs.onDelete);
            expect(a.value).to.be.null;

            await kvs.set([{key: 'a', value: 'c'}]);
            await events.next(kvs.onSet);
            expect(a.value).to.equal('c');
        });

        it('maybe inserts entries that do not exist yet', async () => {
            cache.maybeInsert('a', 'b');
            await cache.sync();
            await events.next(kvs.onSet);
            expect(await kvs.get(['a'])).to.deep.equal([{key: 'a', value: 'b'}]);
        });

        it('maybe inserts entries that already exist in the KVS', async () => {
            await kvs.set([{key: 'a', value: 'b'}]);
            cache.maybeInsert('a', 'c');
            await cache.sync();
            await events.next(kvs.onSet);
            expect(await kvs.get(['a'])).to.deep.equal([{key: 'a', value: 'b'}]);
        });

        it('maybe inserts entries that already exist in the cache', async () => {
            cache.set('a', 'b');
            cache.maybeInsert('a', 'c');
            await cache.sync();
            await events.next(kvs.onSet);
            expect(await kvs.get(['a'])).to.deep.equal([{key: 'a', value: 'b'}]);
        });

        it('returns from flush() immediately if no entries are dirty', async() => {
            await cache.sync();
        });
    });
});

// TODO move this somewhere if it's used more often...
async function collect<I>(iter: AsyncIterable<I>): Promise<I[]> {
    const res = [];
    for await (const i of iter) res.push(i);
    return res;
}
