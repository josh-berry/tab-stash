// Behavioral tests which are common to both client and service.
//
// These are "abstract" tests in that they are run against a concrete
// implementation of the KVS.  So the tests here are imported and reused in both
// client and service tests.

import {expect} from 'chai';

import {Entry, KeyValueStore} from '.';

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

    describe('retrieves blocks of entries in key order', () => {
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

    describe('deletes entries', () => {
        beforeEach(setDefaults);

        it('single entries', async() => {
            await kvs.delete(['a']);
            expect(await kvs.get(['a'])).to.deep.equal([]);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'b', value: 'bob'},
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]);
        });

        it('multiple entries', async() => {
            await kvs.delete(['a', 'b']);
            expect(await kvs.get(['a', 'b'])).to.deep.equal([]);
            expect(await collect(kvs.list())).to.deep.equal([
                {key: 'c', value: 'christine'},
                {key: 'd', value: 'derek'},
            ]);
        });

        it('all entries', async() => {
            await kvs.deleteAll();
            expect(await kvs.get(['a'])).to.deep.equal([]);
            expect(await collect(kvs.list())).to.deep.equal([]);
        });
    });

    describe('delivers events when...', () => {
        beforeEach(setDefaults);

        it('...entries are updated', async() => {
            const {fn: listener, calls} = mock<[Entry<string, string>[]]>();
            const entries: Entry<string, string>[] = [{key: 'a', value: 'f'}];

            kvs.onSet.addListener(listener);
            await kvs.set(entries);

            await wait();
            expect(calls).to.deep.equal([[entries]]);
        });

        it('...entries are deleted', async() => {
            const {fn: listener, calls} = mock<[string[]]>();
            const entries = ['a'];

            kvs.onDelete.addListener(listener);
            await kvs.delete(entries);

            await wait();
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

const wait = () => new Promise(resolve => setTimeout(resolve));
