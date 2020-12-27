// Behavioral tests which are common to both client and service.
//
// These are "abstract" tests in that they are run against a concrete
// implementation of the KVS.  So the tests here are imported and reused in both
// client and service tests.

import {expect} from 'chai';

import {Entry, KeyValueStore} from '.';
import {nextTick} from '../../util';

export function tests(kvs_factory: () => Promise<KeyValueStore<string, string>>) {
    let kvs: KeyValueStore<string, string>;

    beforeEach(async () => {
        kvs = undefined as any;
        kvs = await kvs_factory();
    });

    function setDefaults() {
        return kvs.set([
            {key: 'c', value: 'christine'},
            {key: 'a', value: 'alice'},
            {key: 'b', value: 'bob'},
            {key: 'd', value: 'derek'},
        ]);
    }

    describe('stores and updates entries', () => {
        it('no entries', async() => {
            await kvs.set([]);
        });

        it('single entries', async() => {
            await kvs.set([{key: 'a', value: 'alice'}]);
            expect(await kvs.get(['a']))
                .to.deep.equal([{key: 'a', value: 'alice'}]);
        });

        it('updates single entries', async() => {
            await kvs.set([{key: 'a', value: 'alice'}]);
            expect(await kvs.get(['a']))
                .to.deep.equal([{key: 'a', value: 'alice'}]);
            await kvs.set([{key: 'a', value: 'alison'}]);
            expect(await kvs.get(['a']))
                .to.deep.equal([{key: 'a', value: 'alison'}]);
        });

        it('stores and updates multiple entries at once', async() => {
            await setDefaults();
            await kvs.set([
                {key: 'a', value: 'alison'},
                {key: 'e', value: 'ethel'},
            ]);
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
            expect(await kvs.get(['a', 'b'])).to.deep.equal([]);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]);
        });

        it('...all entries', async() => {
            await kvs.deleteAll();
            expect(await kvs.get(['a'])).to.deep.equal([]);
            expect(await collect(kvs.list())).to.deep.equal([]);
        });

        it('...all entries in a very large database', async() => {
            const items = new Set<string>();
            for (let k = 0; k < 1000; ++k) {
                await kvs.set([{key: `${k}`, value: `${k}`}]);
                items.add(`${k}`);
            }
            kvs.onDelete.addListener(ks => {
                for (const k of ks) items.delete(k);
            });
            await kvs.deleteAll();
            await new Promise(res => setTimeout(res));
            expect(items.size).to.equal(0);
        });
    });

    describe('delivers events when...', () => {
        beforeEach(setDefaults);

        it('...entries are updated', async() => {
            const {fn: listener, calls} = mock<[Entry<string, string>[]]>();
            const entries: Entry<string, string>[] = [{key: 'a', value: 'f'}];

            kvs.onSet.addListener(listener);
            await kvs.set(entries);

            await nextTick();
            expect(calls).to.deep.equal([[entries]]);
        });

        it('...entries are deleted', async() => {
            const {fn: listener, calls} = mock<[string[]]>();
            const entries = ['a'];

            kvs.onDelete.addListener(listener);
            await kvs.delete(entries);

            await nextTick();
            expect(calls).to.deep.equal([[entries]]);
        });
    });
}

// TODO move this somewhere if it's used more often...
async function collect<I>(iter: AsyncIterable<I>): Promise<I[]> {
    const res = [];
    for await (const i of iter) res.push(i);
    return res;
}

function mock<A extends any[]>(): {fn: (...args: A) => void, calls: A[]} {
    const calls: A[] = [];
    const fn = (...args: A): void => { calls.push(args); };
    return {fn, calls};
}
