import {expect} from 'chai';

import MemoryKVS from '../datastore/kvs/memory';
import {nextTick} from '../util';

import * as M from './deleted-items';

const DATASET_SIZE = 50;

describe('model/deleted-items', () => {
    let source: M.Source;
    let model: M.Model;

    beforeEach(async() => {
        source = new MemoryKVS();
        model = new M.Model(source);
    });

    // NOT TESTED: src2state(), because it's trivial

    it('lazily and incrementally loads deleted items', async() => {
        // We first prepopulate the KVS using the model's test-only code, and
        // then we reset the model to an empty/new state.
        await model.makeFakeData_testonly(DATASET_SIZE);
        await nextTick();
        model = new M.Model(source);

        expect(model.state.entries).to.be.empty;
        expect(model.state.fullyLoaded).to.be.false;
        await model.loadMore();
        expect(model.state.entries.length).to.equal(10);
        expect(model.state.fullyLoaded).to.equal(false);

        let len = model.state.entries.length;
        while (! model.state.fullyLoaded) {
            await model.loadMore();
            if (! model.state.fullyLoaded) {
                expect(len).to.be.lessThan(model.state.entries.length);
            }
        }
        expect(model.state.fullyLoaded).to.equal(true);
        expect(model.state.entries.length).to.equal(DATASET_SIZE);
    });

    it('loads items newest-first', async() => {
        await model.makeFakeData_testonly(DATASET_SIZE);
        await nextTick();
        model = new M.Model(source);

        while (! model.state.fullyLoaded) await model.loadMore();
        let date;
        for (const ent of model.state.entries) {
            if (date) expect(date).to.be.greaterThan(ent.deleted_at);
            date = ent.deleted_at;
        }
    });

    it('observes newly-added items', async() => {
        await model.makeFakeData_testonly(DATASET_SIZE);
        await nextTick();
        model = new M.Model(source);
        await model.loadMore();
        expect(model.state.entries.length).to.equal(10);

        const m2 = new M.Model(source);
        await m2.add({title: 'Foo', url: 'http://foo'});
        await nextTick();

        expect(model.state.entries.length).to.equal(11);
        expect(model.state.entries[0]).to.deep.include({
            item: {title: "Foo", url: 'http://foo'}
        });
    });

    it('observes items which were dropped elsewhere', async() => {
        const m2 = new M.Model(source);

        const item = await m2.add({title: 'Foo', url: 'http://foo'});
        await nextTick();
        expect(model.state.entries.length).to.equal(1);
        expect(model.state.entries[0]).to.deep.include({
            item: {title: "Foo", url: 'http://foo'}
        });

        await m2.drop(item.key);
        await nextTick();
        expect(model.state.entries).to.deep.equal([]);
    });

    it('observes item children which were dropped elsewhere', async() => {
        const m2 = new M.Model(source);

        const item = await m2.add({title: "Folder", children: [
            {title: "First", url: "first"},
            {title: "Second", url: "second"},
            {title: "Third", url: "third"},
        ]});
        await nextTick();
        expect(model.state.entries.length).to.equal(1);
        expect(model.state.entries[0]).to.deep.include({item: {
            title: "Folder", children: [
                {title: "First", url: "first"},
                {title: "Second", url: "second"},
                {title: "Third", url: "third"},
            ]
        }});

        await m2.dropChildItem(item.key, 1);
        await nextTick();
        expect(model.state.entries.length).to.equal(1);
        expect(model.state.entries[0]).to.deep.include({item: {
            title: "Folder", children: [
                {title: "First", url: "first"},
                {title: "Third", url: "third"},
            ]
        }});
    });

    describe('filtering', () => {
        it('resets the model when a filter is applied', async() => {
            await model.makeFakeData_testonly(50);
            await nextTick();
            expect(model.state.entries.length).to.equal(50);

            model.filter(/* istanbul ignore next */ item => false);
            expect(model.state.entries.length).to.equal(0);
        });

        it('stops an in-progress load when a filter is applied', async() => {
            await model.makeFakeData_testonly(50);
            await nextTick();
            expect(model.state.entries.length).to.equal(50);
            model = new M.Model(source);

            const p = model.loadMore();
            // We try a few times just to make sure we hit the right race
            // condition inside loadMore().
            for (let i = 0; i < 3; ++i) {
                model.filter(item => false);
                await new Promise(r => r(undefined));
            }
            await p;
            expect(model.state.entries.length).to.equal(0);
        });

        it('loads only items which match the applied filter', async() => {
            await model.makeFakeData_testonly(50);
            await nextTick();
            expect(model.state.entries.length).to.equal(50);

            model.filter(item => item.title.includes('cat'));
            expect(model.state.entries.length).to.equal(0);

            while (! model.state.fullyLoaded) await model.loadMore();
            expect(model.state.entries.length).to.be.greaterThan(0);
            for (const c of model.state.entries) {
                expect(c.item.title).to.include('cat');
            }
        });

        it('properly handles filters which exclude all items', async() => {
            await model.makeFakeData_testonly(50);
            await nextTick();

            model.filter(item => false);
            while (! model.state.fullyLoaded) await model.loadMore();
            expect(model.state.entries.length).to.equal(0);
            expect(model.state.fullyLoaded).to.be.true;
        })

        it('only loads new items that match the applied filter', async() => {
            model.filter(item => item.title.includes('cat'));
            const m2 = new M.Model(source);
            await m2.makeFakeData_testonly(50);
            await nextTick();

            expect(model.state.entries.length).to.be.greaterThan(0);
            for (const c of model.state.entries) {
                expect(c.item.title).to.include('cat');
            }
        });
    });

    it('drops items older than a certain timestamp', async() => {
        const dropTime = new Date(Date.now() - 3*24*60*60*1000);
        await model.makeFakeData_testonly(100);
        await nextTick();

        // Check that our test data has sufficiently-old entries.
        expect(model.state.entries[model.state.entries.length - 1].deleted_at)
            .to.be.lessThan(dropTime);

        // dropOlderThan() should work even if the model has nothing loaded.
        model = new M.Model(source);
        await model.dropOlderThan(dropTime.valueOf());
        expect(model.state.entries.length).to.equal(0);

        while (! model.state.fullyLoaded) await model.loadMore();
        expect(model.state.entries.length).to.be.greaterThan(0);
        for (const e of model.state.entries) {
            expect(e.deleted_at).to.be.greaterThan(dropTime);
        }
    });
});
