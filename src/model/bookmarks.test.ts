import {expect} from 'chai';
import browser from 'webextension-polyfill';

import * as events from '../mock/events';

import * as M from './bookmarks';

import {make_bookmarks} from './fixtures.testlib';

describe('model/bookmarks', () => {
    let bms: {[k: string]: M.Bookmark};
    let model: M.Model;

    beforeEach(async () => {
        // Typically bookmarks are loaded as a whole tree, so that's what we do
        // here.
        bms = await make_bookmarks();
        model = await M.Model.from_browser();
        await events.watch([model.by_id.onInsert, model.by_id.onUpdate])
            .untilNextTick();
    });

    describe('loads bookmarks from the browser', () => {
        it('creates the right bookmark objects', () => {
            for (const l in bms) {
                const template = bms[l];
                const bm = model.by_id.get(template.id);
                expect(bm).to.deep.include(template);

                const parent = model.by_id.get(template.parentId!);
                expect(parent!.children).not.to.be.undefined;
                expect(parent!.children![template.index!]).to.equal(bm);
            }
        });

        it('creates folders correctly', () => {
            for (const l in bms) {
                const template = bms[l];
                if (! template.children) continue;

                const bm = model.by_id.get(bms[l].id);
                const p = model.by_parent.get(bms[l].id);
                expect(bm).not.to.be.undefined;
                expect(p).not.to.be.undefined;
                // The following is not actually true because the index wraps
                // its return value in a readonly wrapper...
                //
                //expect(p).to.equal(bm!.children);
                expect(p).to.deep.equal(bm!.children);
            }
        });

        it('indexes URLs correctly', () => {
            expect(model.by_url.get('/foo')).to.deep.equal([bms.foo, bms.foo2]);
            expect(model.by_url.get('/a')).to.deep.equal([bms.a]);
        });
    });

    it('inserts bookmarks into the tree', async () => {
        const bm = await browser.bookmarks.create({
            title: 'New', url: '/new',
            parentId: bms.tools.id, index: 2
        });
        await events.next(browser.bookmarks.onCreated);
        await events.next(model.by_id.onInsert);
        await events.nextN(model.by_id.onUpdate, 2); // parents are updated

        expect(model.by_id.get(bm.id)).to.deep.equal(bm);
        expect(model.by_url.get('/new')).to.deep.equal([bm]);
        expect(model.by_parent.get(bms.tools.id)).to.deep.equal([
            model.by_id.get(bms.likes.id),
            model.by_id.get(bms.ok.id),
            model.by_id.get(bm.id),
        ]);
    });

    it('inserts duplicate bookmarks gracefully', async () => {
        const new_b = {id: bms.b.id, title: 'The New A', url: '/new_a'};
        events.send(browser.bookmarks.onCreated, new_b.id, new_b);
        await events.next(browser.bookmarks.onCreated);

        // all nodes along the path receive update events
        await events.nextN(model.by_id.onUpdate, 4);

        expect(model.by_id.get(bms.b.id)).to.deep.include(new_b);
        expect(model.by_url.get('/b')).to.deep.equal([]);
        expect(model.by_url.get('/new_a')).to.deep.equal([model.by_id.get(bms.b.id)]);
        expect(model.by_parent.get(bms.subfolder.id)).to.deep.equal([
            model.by_id.get(bms.b.id),
            model.by_id.get(bms.c.id),
            model.by_id.get(bms.d.id),
        ]);
    });

    it('updates bookmarks', async () => {
        await browser.bookmarks.update(bms.b.id, {title: 'The New A', url: '/new_a'});
        await events.next(browser.bookmarks.onChanged);
        await events.nextN(model.by_id.onUpdate, 4); // all nodes on path

        expect(model.by_id.get(bms.b.id))
            .to.deep.include({title: 'The New A', url: '/new_a'});
        expect(model.by_url.get('/b')).to.deep.equal([]);
        expect(model.by_url.get('/new_a')).to.deep.equal([model.by_id.get(bms.b.id)]);
        expect(model.by_parent.get(bms.subfolder.id)).to.deep.equal([
            model.by_id.get(bms.b.id),
            model.by_id.get(bms.c.id),
            model.by_id.get(bms.d.id),
        ]);
    });

    it('updates folder titles', async () => {
        await browser.bookmarks.update(bms.subfolder.id, {title: 'Secret'});
        await events.next(browser.bookmarks.onChanged);
        await events.nextN(model.by_id.onUpdate, 3); // all nodes on path
        expect(model.by_id.get(bms.subfolder.id)!.title).to.equal('Secret');
    });

    it('removes bookmarks idempotently', async () => {
        await browser.bookmarks.remove(bms.b.id);
        const ev = await events.next(browser.bookmarks.onRemoved);
        await events.next(model.by_id.onDelete);
        await events.nextN(model.by_id.onUpdate, 3); // all nodes on path
        await events.nextN(model.by_id.onUpdate, 2); // shuffling siblings

        events.send(browser.bookmarks.onRemoved, ...ev);
        await events.next(browser.bookmarks.onRemoved);

        expect(model.by_id.get(bms.b.id)).to.be.undefined;
        expect(model.by_url.get('/b')).to.deep.equal([]);
        expect(model.by_parent.get(bms.subfolder.id)).to.deep.equal([
            {...bms.c, parentId: bms.subfolder.id, index: 0},
            {...bms.d, parentId: bms.subfolder.id, index: 1},
        ]);
    });

    it('removes folders idempotently', async () => {
        await browser.bookmarks.removeTree(bms.menu.id);
        const ev = await events.next(browser.bookmarks.onRemoved);
        await events.nextN(model.by_id.onDelete, 9); // self and subtree
        await events.nextN(model.by_id.onUpdate, 1); // all nodes on path

        events.send(browser.bookmarks.onRemoved, ...ev);
        await events.next(browser.bookmarks.onRemoved);

        expect(model.by_id.get(bms.menu.id)).to.be.undefined;
        expect(model.by_id.get(bms.a.id)).to.be.undefined;
        expect(model.by_id.get(bms.subfolder.id)).to.be.undefined;

        expect(model.by_url.get('/a')).to.deep.equal([]);
        expect(model.by_url.get('/b')).to.deep.equal([]);

        expect(model.by_parent.get(bms.subfolder.id)).to.deep.equal([]);
        expect(model.by_parent.get(bms.menu.id)).to.deep.equal([]);
        expect(model.by_parent.get(model.root.id)).to.deep.equal([
            model.by_id.get(bms.tools.id),
        ]);
    });

    it('moves bookmarks', async () => {
        await model.move(bms.a.id, model.root.id, 1);
        await events.next(browser.bookmarks.onMoved);
        await events.nextN(model.by_id.onUpdate, 3); // all nodes on both paths
        await events.nextN(model.by_id.onUpdate, 2); // shuffling siblings (remove)
        await events.nextN(model.by_id.onUpdate, 1); // shuffling siblings (add)

        expect(model.by_id.get(bms.a.id))
            .to.deep.include({parentId: model.root.id, index: 1});
        expect(model.by_parent.get(model.root.id)).to.deep.equal([
            model.by_id.get(bms.tools.id),
            model.by_id.get(bms.a.id),
            model.by_id.get(bms.menu.id),
        ]);
        expect(model.by_parent.get(bms.menu.id)).to.deep.equal([
            model.by_id.get(bms.foo2.id),
            model.by_id.get(bms.empty.id),
            model.by_id.get(bms.sep.id),
            model.by_id.get(bms.subfolder.id),
        ]);
    });
});
