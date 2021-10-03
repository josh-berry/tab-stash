import {expect} from 'chai';
import browser from 'webextension-polyfill';

import * as events from '../mock/events';

import * as M from './bookmarks';

import {B, BookmarkFixture, make_bookmarks} from './fixtures.testlib';

describe('model/bookmarks', () => {
    let bms: BookmarkFixture;
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
                const template = bms[l as keyof typeof bms];
                const bm = model.by_id.get(template.id);
                expect(bm).to.deep.include(template);

                const parent = model.by_id.get(template.parentId!);
                expect(parent!.children).not.to.be.undefined;
                expect(parent!.children![template.index!]).to.equal(bm);
            }
        });

        it('creates folders correctly', () => {
            for (const l in bms) {
                const template = bms[l as keyof typeof bms];
                if (! template.children) continue;

                const bm = model.by_id.get(template.id);
                const p = model.by_parent.get(template.id);
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
            expect(model.by_url.get(`${B}#doug`)).to.deep.equal([bms.doug_1, bms.doug_2]);
            expect(model.by_url.get(`${B}#alice`)).to.deep.equal([bms.alice]);
        });
    });

    it('inserts bookmarks into the tree', async () => {
        const new_bm = await browser.bookmarks.create({
            title: 'New', url: '/new',
            parentId: bms.root.id, index: 2
        });
        await events.next(browser.bookmarks.onCreated);
        await events.next(model.by_id.onInsert);
        await events.next(model.by_id.onUpdate); // self-update???
        await events.nextN(model.by_id.onUpdate, 3); // parents are updated

        expect(model.by_id.get(new_bm.id)).to.deep.equal(new_bm);
        expect(model.by_url.get('/new')).to.deep.equal([new_bm]);
        expect(model.by_parent.get(bms.root.id)).to.deep.equal([
            model.by_id.get(bms.doug_1.id),
            model.by_id.get(bms.francis.id),
            model.by_id.get(new_bm.id),
            model.by_id.get(bms.outside.id),
            model.by_id.get(bms.stash_root.id),
        ]);
        expect(model.by_id.get(bms.doug_1.id)!.index).to.equal(0);
        expect(model.by_id.get(bms.francis.id)!.index).to.equal(1);
        expect(model.by_id.get(new_bm.id)!.index).to.equal(2);
        expect(model.by_id.get(bms.outside.id)!.index).to.equal(3);
        expect(model.by_id.get(bms.stash_root.id)!.index).to.equal(4);
    });

    it('inserts duplicate bookmarks gracefully', async () => {
        const new_a = {
            id: bms.alice.id, title: 'The New A', url: '/new_a',
            parentId: bms.outside.id, index: 0,
        };
        events.send(browser.bookmarks.onCreated, new_a.id, new_a);
        await events.next(browser.bookmarks.onCreated);

        // all nodes along the path receive update events
        await events.nextN(model.by_id.onUpdate, 4);

        expect(model.by_id.get(bms.alice.id)).to.deep.include(new_a);
        expect(model.by_url.get(`${B}#alice`)).to.deep.equal([]);
        expect(model.by_url.get('/new_a'))
            .to.deep.equal([model.by_id.get(bms.alice.id)]);
        expect(model.by_parent.get(bms.outside.id)).to.deep.equal([
            model.by_id.get(bms.alice.id),
            model.by_id.get(bms.separator.id),
            model.by_id.get(bms.bob.id),
            model.by_id.get(bms.empty.id),
        ]);
    });

    it('updates bookmarks', async () => {
        await browser.bookmarks.update(bms.alice.id, {title: 'The New A', url: '/new_a'});
        await events.next(browser.bookmarks.onChanged);
        await events.nextN(model.by_id.onUpdate, 4); // all nodes on path

        expect(model.by_id.get(bms.alice.id))
            .to.deep.include({title: 'The New A', url: '/new_a'});
        expect(model.by_url.get(`${B}#alice`)).to.deep.equal([]);
        expect(model.by_url.get('/new_a'))
            .to.deep.equal([model.by_id.get(bms.alice.id)]);
        expect(model.by_parent.get(bms.outside.id)).to.deep.equal([
            model.by_id.get(bms.alice.id),
            model.by_id.get(bms.separator.id),
            model.by_id.get(bms.bob.id),
            model.by_id.get(bms.empty.id),
        ]);
    });

    it('updates folder titles', async () => {
        await browser.bookmarks.update(bms.names.id, {title: 'Secret'});
        await events.next(browser.bookmarks.onChanged);
        await events.nextN(model.by_id.onUpdate, 4); // all nodes on path
        expect(model.by_id.get(bms.names.id)!.title).to.equal('Secret');
    });

    it('removes bookmarks idempotently', async () => {
        await browser.bookmarks.remove(bms.bob.id);
        const ev = await events.next(browser.bookmarks.onRemoved);
        await events.next(model.by_id.onDelete);
        await events.nextN(model.by_id.onUpdate, 3); // all nodes on path
        await events.nextN(model.by_id.onUpdate, 1); // shuffling siblings

        events.send(browser.bookmarks.onRemoved, ...ev);
        await events.next(browser.bookmarks.onRemoved);

        expect(model.by_id.get(bms.bob.id)).to.be.undefined;
        expect(model.by_url.get(`${B}#bob`)).to.deep.equal([]);
        expect(model.by_parent.get(bms.outside.id)).to.deep.equal([
            model.by_id.get(bms.alice.id),
            model.by_id.get(bms.separator.id),
            model.by_id.get(bms.empty.id),
        ]);
        expect(model.by_id.get(bms.alice.id)!.index).to.equal(0);
        expect(model.by_id.get(bms.separator.id)!.index).to.equal(1);
        expect(model.by_id.get(bms.empty.id)!.index).to.equal(2);
    });

    it('removes folders idempotently', async () => {
        await browser.bookmarks.removeTree(bms.names.id);
        const ev = await events.next(browser.bookmarks.onRemoved);
        await events.nextN(model.by_id.onDelete, 5); // self and subtree
        await events.nextN(model.by_id.onUpdate, 1); // sibling shuffle
        await events.nextN(model.by_id.onUpdate, 3); // all nodes on path

        events.send(browser.bookmarks.onRemoved, ...ev);
        await events.next(browser.bookmarks.onRemoved);

        expect(model.by_id.get(bms.names.id)).to.be.undefined;
        expect(model.by_id.get(bms.doug_2.id)).to.be.undefined;
        expect(model.by_id.get(bms.helen.id)).to.be.undefined;
        expect(model.by_id.get(bms.patricia.id)).to.be.undefined;
        expect(model.by_id.get(bms.nate.id)).to.be.undefined;

        expect(model.by_url.get(`${B}#helen`)).to.deep.equal([]);
        expect(model.by_url.get(`${B}#doug`)).to.deep.equal([
            model.by_id.get(bms.doug_1.id)
        ]);

        expect(model.by_parent.get(bms.names.id)).to.deep.equal([]);
        expect(model.by_parent.get(bms.stash_root.id)).to.deep.equal([
            model.by_id.get(bms.unnamed.id),
        ]);
    });

    it('reorders bookmarks (forward)', async () => {
        await model.move(bms.alice.id, bms.outside.id, 3);
        await events.next(browser.bookmarks.onMoved);
        await events.nextN(model.by_id.onUpdate, 4); // shuffles ordering
        await events.nextN(model.by_id.onUpdate, 3); // all nodes in path
        await events.nextN(model.by_id.onUpdate, 3); // all nodes in path (twice???)

        expect(model.by_parent.get(bms.outside.id)).to.deep.equal([
            model.by_id.get(bms.separator.id),
            model.by_id.get(bms.bob.id),
            model.by_id.get(bms.empty.id),
            model.by_id.get(bms.alice.id),
        ]);
        expect(model.by_id.get(bms.separator.id)).to.deep.include({index: 0});
        expect(model.by_id.get(bms.bob.id)).to.deep.include({index: 1});
        expect(model.by_id.get(bms.empty.id)).to.deep.include({index: 2});
        expect(model.by_id.get(bms.alice.id)).to.deep.include({index: 3});
    });

    it('reorders bookmarks (backward)', async () => {
        await model.move(bms.empty.id, bms.outside.id, 0);
        await events.next(browser.bookmarks.onMoved);
        await events.nextN(model.by_id.onUpdate, 4); // shuffles ordering
        await events.nextN(model.by_id.onUpdate, 3); // all nodes in path
        await events.nextN(model.by_id.onUpdate, 3); // all nodes in path (twice???)

        expect(model.by_parent.get(bms.outside.id)).to.deep.equal([
            model.by_id.get(bms.empty.id),
            model.by_id.get(bms.alice.id),
            model.by_id.get(bms.separator.id),
            model.by_id.get(bms.bob.id),
        ]);
        expect(model.by_id.get(bms.empty.id)).to.deep.include({index: 0});
        expect(model.by_id.get(bms.alice.id)).to.deep.include({index: 1});
        expect(model.by_id.get(bms.separator.id)).to.deep.include({index: 2});
        expect(model.by_id.get(bms.bob.id)).to.deep.include({index: 3});
    });

    it('moves bookmarks between folders', async () => {
        await model.move(bms.bob.id, bms.names.id, 2);
        await events.next(browser.bookmarks.onMoved);
        await events.nextN(model.by_id.onUpdate, 4); // shuffles ordering (source)
        await events.nextN(model.by_id.onUpdate, 2); // shuffles ordering (dest)
        await events.nextN(model.by_id.onUpdate, 3); // all nodes in path
        await events.nextN(model.by_id.onUpdate, 3); // all nodes in path (twice???)

        expect(model.by_parent.get(bms.outside.id)).to.deep.equal([
            model.by_id.get(bms.alice.id),
            model.by_id.get(bms.separator.id),
            model.by_id.get(bms.empty.id),
        ]);
        expect(model.by_id.get(bms.alice.id)).to.deep.include({index: 0});
        expect(model.by_id.get(bms.separator.id)).to.deep.include({index: 1});
        expect(model.by_id.get(bms.empty.id)).to.deep.include({index: 2});

        expect(model.by_parent.get(bms.names.id)).to.deep.equal([
            model.by_id.get(bms.doug_2.id),
            model.by_id.get(bms.helen.id),
            model.by_id.get(bms.bob.id),
            model.by_id.get(bms.patricia.id),
            model.by_id.get(bms.nate.id),
        ]);
        expect(model.by_id.get(bms.doug_2.id)).to.deep.include({index: 0});
        expect(model.by_id.get(bms.helen.id)).to.deep.include({index: 1});
        expect(model.by_id.get(bms.bob.id)).to.deep.include({index: 2});
        expect(model.by_id.get(bms.patricia.id)).to.deep.include({index: 3});
        expect(model.by_id.get(bms.nate.id)).to.deep.include({index: 4});
    });
});
