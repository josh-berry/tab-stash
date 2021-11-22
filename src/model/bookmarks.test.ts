import {expect} from 'chai';
import browser, {Bookmarks} from 'webextension-polyfill';

import * as events from '../mock/events';
import {nextTick} from '../util';

import * as M from './bookmarks';

import {B, BookmarkFixture, make_bookmarks, STASH_ROOT_NAME} from './fixtures.testlib';

describe('model/bookmarks', () => {
    let bms: BookmarkFixture;
    let model: M.Model;

    beforeEach(async () => {
        // Typically bookmarks are loaded as a whole tree, so that's what we do
        // here.
        bms = await make_bookmarks();
        model = await M.Model.from_browser(STASH_ROOT_NAME);
        expect(events.pendingCount(), "Pending events in beforeEach").to.equal(0);
    });

    describe('loads bookmarks from the browser', () => {
        it('creates the right bookmark objects', () => {
            for (const l in bms) {
                const template = bms[l as keyof typeof bms];
                const bm = model.node(template.id);
                if (template.url) {
                    expect(bm).to.deep.include({
                        id: template.id,
                        title: template.title,
                        url: template.url,
                    });
                }

                const parent = model.folder(template.parentId!);
                expect(parent).to.have.property('children');
                expect(parent.children[template.index!]).to.equal(bm!.id);
            }
        });

        it('creates folders correctly', () => {
            for (const l in bms) {
                const template = bms[l as keyof typeof bms];
                if (! template.children) continue;

                const bm = model.folder(template.id);
                expect(bm.id).to.equal(template.id);
                expect(bm.children).to.deep.equal(template.children.map(c => c.id));
            }
        });

        it('indexes URLs correctly', () => {
            expect(model.bookmarksWithURL(`${B}#doug`)).to.deep.equal(new Set([
                model.node(bms.doug_1.id),
                model.node(bms.doug_2.id),
            ]));
            expect(model.bookmarksWithURL(`${B}#alice`))
                .to.deep.equal(new Set([model.node(bms.alice.id)]));
        });
    });

    it('finds all URLs in the stash root', async () => {
        expect(Array.from(model.urlsInStash()).sort()).to.deep.equal([
            `${B}#1`, `${B}#2`, `${B}#3`, `${B}#4`,
            `${B}#5`, `${B}#6`, `${B}#7`, `${B}#8`,
            `${B}#doug`,
            `${B}#helen`,
            `${B}#nate`,
            `${B}#patricia`,
            `${B}#undyne`,
        ]);
    });

    it('inserts bookmarks into the tree', async () => {
        const new_bm = await browser.bookmarks.create({
            title: 'New', url: '/new',
            parentId: bms.root.id, index: 2
        });
        delete new_bm.index;
        delete new_bm.type;
        await events.next(browser.bookmarks.onCreated);

        expect(model.node(new_bm.id as M.NodeID)).to.deep.equal({
            ...new_bm, $visible: true, $selected: false,
        });
        expect(model.bookmarksWithURL('/new')).to.deep.equal(new Set([{
            ...new_bm, $visible: true, $selected: false,
        }]));
        expect(model.folder(bms.root.id).children).to.deep.equal([
            bms.doug_1.id,
            bms.francis.id,
            new_bm.id,
            bms.outside.id,
            bms.stash_root.id,
        ]);
    });

    it('inserts duplicate bookmarks gracefully', async () => {
        const new_a: Bookmarks.BookmarkTreeNode = {
            id: bms.alice.id, title: 'The New A', url: '/new_a',
            parentId: bms.outside.id, index: 0,
        };
        events.send(browser.bookmarks.onCreated, new_a.id, new_a);
        await events.next(browser.bookmarks.onCreated);

        new_a.dateAdded = undefined;
        delete new_a.type;
        delete new_a.index;

        expect(model.node(bms.alice.id)).to.deep.include(new_a);
        expect(model.bookmarksWithURL(`${B}#alice`)).to.deep.equal(new Set([]));
        expect(model.bookmarksWithURL('/new_a'))
            .to.deep.equal(new Set([model.node(bms.alice.id)]));
        expect(model.folder(bms.outside.id).children).to.deep.equal([
            bms.alice.id,
            bms.separator.id,
            bms.bob.id,
            bms.empty.id,
        ]);
    });

    it('updates bookmarks', async () => {
        await browser.bookmarks.update(bms.alice.id, {title: 'The New A', url: '/new_a'});
        await events.next(browser.bookmarks.onChanged);

        expect(model.node(bms.alice.id))
            .to.deep.include({title: 'The New A', url: '/new_a'});
        expect(model.bookmarksWithURL(`${B}#alice`)).to.deep.equal(new Set());
        expect(model.bookmarksWithURL('/new_a'))
            .to.deep.equal(new Set([model.node(bms.alice.id)]));
        expect(model.folder(bms.outside.id).children).to.deep.equal([
            bms.alice.id,
            bms.separator.id,
            bms.bob.id,
            bms.empty.id,
        ]);
    });

    it('updates folder titles', async () => {
        await browser.bookmarks.update(bms.names.id, {title: 'Secret'});
        await events.next(browser.bookmarks.onChanged);
        expect(model.node(bms.names.id)!.title).to.equal('Secret');
    });

    it('removes bookmarks idempotently', async () => {
        await browser.bookmarks.remove(bms.bob.id);
        const ev = await events.next(browser.bookmarks.onRemoved);

        events.send(browser.bookmarks.onRemoved, ...ev);
        await events.next(browser.bookmarks.onRemoved);

        expect(() => model.node(bms.bob.id)).to.throw(Error);
        expect(model.bookmarksWithURL(`${B}#bob`)).to.deep.equal(new Set([]));
        expect(model.folder(bms.outside.id).children).to.deep.equal([
            bms.alice.id,
            bms.separator.id,
            bms.empty.id,
        ]);
    });

    it('removes folders idempotently', async () => {
        expect(model.node(bms.names.id)).not.to.be.undefined;
        await browser.bookmarks.removeTree(bms.names.id);
        const ev = await events.next(browser.bookmarks.onRemoved);

        events.send(browser.bookmarks.onRemoved, ...ev);
        await events.next(browser.bookmarks.onRemoved);

        expect(() => model.node(bms.names.id)).to.throw(Error);
        expect(() => model.node(bms.doug_2.id)).to.throw(Error);
        expect(() => model.node(bms.helen.id)).to.throw(Error);
        expect(() => model.node(bms.patricia.id)).to.throw(Error);
        expect(() => model.node(bms.nate.id)).to.throw(Error);

        expect(model.bookmarksWithURL(`${B}#helen`)).to.deep.equal(new Set([]));
        expect(model.bookmarksWithURL(`${B}#doug`)).to.deep.equal(new Set([
            model.node(bms.doug_1.id)
        ]));

        expect(() => model.node(bms.names.id)).to.throw(Error);
        expect(model.folder(bms.stash_root.id).children).to.deep.equal([
            bms.unnamed.id,
            bms.big_stash.id,
        ]);
    });

    it('reorders bookmarks (forward)', async () => {
        const p = model.move(bms.alice.id, bms.outside.id, 4);
        await events.next(browser.bookmarks.onMoved);
        await p;

        expect(model.folder(bms.outside.id).children).to.deep.equal([
            bms.separator.id,
            bms.bob.id,
            bms.empty.id,
            bms.alice.id,
        ]);
    });

    it('reorders bookmarks (backward)', async () => {
        const p = model.move(bms.empty.id, bms.outside.id, 0);
        await events.next(browser.bookmarks.onMoved);
        await p;

        expect(model.folder(bms.outside.id).children).to.deep.equal([
            bms.empty.id,
            bms.alice.id,
            bms.separator.id,
            bms.bob.id,
        ]);
    });

    it('moves bookmarks between folders', async () => {
        const p = model.move(bms.bob.id, bms.names.id, 2);
        await events.next(browser.bookmarks.onMoved);
        await p;

        expect(model.folder(bms.outside.id).children).to.deep.equal([
            bms.alice.id,
            bms.separator.id,
            bms.empty.id,
        ]);
        expect(model.folder(bms.names.id).children).to.deep.equal([
            bms.doug_2.id,
            bms.helen.id,
            bms.bob.id,
            bms.patricia.id,
            bms.nate.id,
        ]);
    });

    describe('reports info about bookmarks', () => {
        it('bookmark is in a folder', () => {
            const undyne = model.node(bms.undyne.id)!;
            expect(model.isNodeInFolder(undyne, bms.stash_root.id))
                .to.be.true;
        });

        it('bookmark is NOT in a folder', () => {
            const alice = model.node(bms.alice.id)!;
            expect(model.isNodeInFolder(alice, bms.stash_root.id))
                .to.be.false;
        });

        it('path to a bookmark', async () => {
            const helen = model.node(bms.helen.id)!;
            expect(model.pathTo(helen)).to.deep.equal([
                {parent: model.node(model.root_id!), index: 0},
                {parent: model.node(bms.root.id), index: 3},
                {parent: model.node(bms.stash_root.id), index: 0},
                {parent: model.node(bms.names.id), index: 1},
            ]);
        });
    });

    describe('tracks the stash root', () => {
        it('finds the stash root during construction', async () => {
            expect(model.stash_root.value).to.equal(model.node(bms.stash_root.id));
            expect(model.stash_root_warning.value).to.be.undefined;
        });

        it('loses the stash root when it is renamed', async () => {
            await browser.bookmarks.update(bms.stash_root.id, {title: 'Old Root'});
            await events.next(browser.bookmarks.onChanged);
            expect(events.pendingCount()).to.equal(0);

            expect(model.stash_root.value).to.be.undefined;
            expect(model.stash_root_warning.value).to.be.undefined;
        });

        it('finds multiple stash roots at the same level', async () => {
            const new_root = await browser.bookmarks.create(
                {parentId: bms.root.id, title: STASH_ROOT_NAME});
            await events.next(browser.bookmarks.onCreated);
            expect(events.pendingCount()).to.equal(0);

            // Either the stash root is the new root OR the old root, but it can
            // never be both.
            expect(model.stash_root.value).to.satisfy((m: M.Bookmark) =>
                (m.id === new_root.id) !== (m.id === bms.stash_root.id));
            expect(model.stash_root_warning.value).not.to.be.undefined;
        });

        it('finds the topmost stash root', async () => {
            await browser.bookmarks.create(
                {parentId: bms.outside.id, title: STASH_ROOT_NAME});
            await events.next(browser.bookmarks.onCreated);
            expect(events.pendingCount()).to.equal(0);

            expect(model.stash_root.value).to.equal(model.node(bms.stash_root.id));
            expect(model.stash_root_warning.value).to.be.undefined;
        });

        it('follows the topmost stash root', async () => {
            await browser.bookmarks.move(bms.stash_root.id, {
                parentId: bms.outside.id,
            });
            await events.next(browser.bookmarks.onMoved);
            expect(events.pendingCount()).to.equal(0);

            expect(model.stash_root.value).to.equal(model.node(bms.stash_root.id));
            expect(model.stash_root_warning.value).to.be.undefined;

            const bm = await browser.bookmarks.create(
                {parentId: bms.root.id, title: STASH_ROOT_NAME});
            await events.next(browser.bookmarks.onCreated);
            expect(events.pendingCount()).to.equal(0);

            expect(model.stash_root.value).to.deep.include({id: bm.id});
            expect(model.stash_root_warning.value).to.be.undefined;
        });
    });

    describe('ensureStashRoot()', () => {
        it('when it already exists', async () => {
            const root = await model.ensureStashRoot();
            expect(model.stash_root.value).to.equal(root);
            expect(model.stash_root.value).to.equal(model.node(bms.stash_root.id));
            expect(model.stash_root_warning.value).to.be.undefined;
        });

        it('when it does not exist', async () => {
            await browser.bookmarks.update(bms.stash_root.id, {title: 'Old Root'});
            await events.next(browser.bookmarks.onChanged);
            expect(events.pendingCount()).to.equal(0);
            expect(model.stash_root.value).to.be.undefined;

            const p = model.ensureStashRoot();
            await events.next(browser.bookmarks.onCreated);
            expect(events.pendingCount()).to.equal(0);

            const root = await p;
            expect(root).not.to.be.undefined;
            expect(model.stash_root.value).to.equal(root);
        });

        it('reentrant', async () => {
            // Testing the case where two different bookmark instances on two
            // different computers (or maybe just in two different windows on
            // the same computer) create two different stash roots.
            await browser.bookmarks.update(bms.stash_root.id, {title: 'Old Root'});
            await events.next(browser.bookmarks.onChanged);
            expect(events.pendingCount()).to.equal(0);
            expect(model.stash_root.value).to.be.undefined;

            const model2 = await M.Model.from_browser(STASH_ROOT_NAME);

            const p1 = model.ensureStashRoot();
            const p2 = model2.ensureStashRoot();
            await events.nextN(browser.bookmarks.onCreated, 2);
            await events.nextN(browser.bookmarks.onRemoved, 1);
            expect(events.pendingCount()).to.equal(0);

            const root1 = await p1;
            const root2 = await p2;
            expect(root1).not.to.be.undefined;
            expect(root2).not.to.be.undefined;
            expect(root1).to.deep.equal(root2);
            expect(model.stash_root.value).to.equal(root1);
            expect(model2.stash_root.value).to.equal(root2);
        });
    });

    describe('selection model', () => {
        it('tracks selected items', async () => {
            model.setSelected([
                model.node(bms.undyne.id),
                model.node(bms.nate.id),
                model.node(bms.helen.id),
            ], true);

            expect(Array.from(model.selectedItems())).to.deep.equal([
                model.node(bms.helen.id),
                model.node(bms.nate.id),
                model.node(bms.undyne.id),
            ]);

            expect(model.isSelected(model.node(bms.helen.id))).to.be.true;
            expect(model.isSelected(model.node(bms.nate.id))).to.be.true;
            expect(model.isSelected(model.node(bms.undyne.id))).to.be.true;

            expect(model.isSelected(model.node(bms.patricia.id))).to.be.false;
            expect(model.isSelected(model.node(bms.unnamed.id))).to.be.false;
        });

        it('identifies items in a range within a folder', async () => {
            const range = model.itemsInRange(
                model.node(bms.doug_2.id), model.node(bms.patricia.id));
            expect(range).to.deep.equal([
                model.node(bms.doug_2.id),
                model.node(bms.helen.id),
                model.node(bms.patricia.id),
            ]);
        });

        it('identifies items in a range within a folder (backwards)', async () => {
            const range = model.itemsInRange(
                model.node(bms.patricia.id), model.node(bms.doug_2.id));
            expect(range).to.deep.equal([
                model.node(bms.doug_2.id),
                model.node(bms.helen.id),
                model.node(bms.patricia.id),
            ]);
        });

        it('identifies a single-item range', async () => {
            const range = model.itemsInRange(
                model.node(bms.helen.id), model.node(bms.helen.id));
            expect(range).to.deep.equal([
                model.node(bms.helen.id),
            ]);
        });

        it('refuses to identify ranges across folders', async () => {
            // for now, anyway...
            expect(model.itemsInRange(
                    model.node(bms.doug_2.id), model.node(bms.undyne.id)))
                .to.be.null;
        });

        it('removes filtered items from ranges', async () => {
            model.filter.value = node =>
                ! ('url' in node) || ! node.url.includes('helen');
            await nextTick(); // to update the filter

            expect(model.node(bms.doug_2.id).$visible).to.be.true;
            expect(model.node(bms.helen.id).$visible).to.be.false;
            expect(model.itemsInRange(
                    model.node(bms.doug_2.id), model.node(bms.nate.id)))
                .to.deep.equal([
                    model.node(bms.doug_2.id),
                    model.node(bms.patricia.id),
                    model.node(bms.nate.id),
                ]);
        });
    });

    describe('cleans up empty folders', () => {
        it('when deleting stash bookmarks from an unnamed folder', async () => {
            const p = model.remove(bms.undyne.id);
            await events.nextN(browser.bookmarks.onRemoved, 2);
            await p;

            expect(model.getNode(bms.unnamed.id)).to.be.undefined;
            expect(model.folder(bms.stash_root.id).children).to.deep.equal([
                bms.names.id,
                bms.big_stash.id,
            ]);
        });

        it('when moving stash bookmarks to another folder', async () => {
            const p = model.move(bms.undyne.id, bms.names.id, 5);
            await events.next(browser.bookmarks.onMoved);
            await events.next(browser.bookmarks.onRemoved);
            await p;

            expect(model.getNode(bms.unnamed.id)).to.be.undefined;
            expect(model.folder(bms.stash_root.id).children).to.deep.equal([
                bms.names.id,
                bms.big_stash.id,
            ]);
            expect(model.folder(bms.names.id).children).to.deep.equal([
                bms.doug_2.id,
                bms.helen.id,
                bms.patricia.id,
                bms.nate.id,
                bms.undyne.id,
            ]);
        });

        describe('but not', () => {
            let new_unnamed: M.Node;
            let new_child: M.Node;

            beforeEach(async() => {
                const p1 = model.create({
                    title: 'saved-1970-01-01T00:00:00.000Z',
                    parentId: bms.outside.id,
                });
                await events.next(browser.bookmarks.onCreated);
                new_unnamed = await p1;

                const p2 = model.create({
                    title: 'Foo',
                    url: 'foo',
                    parentId: new_unnamed.id,
                });
                await events.next(browser.bookmarks.onCreated);
                new_child = await p2;
            });

            it('when deleting bookmarks outside the stash root', async () => {
                const p = model.remove(new_child.id);
                await events.nextN(browser.bookmarks.onRemoved, 1);
                await p;

                expect(model.getNode(new_child.id)).to.be.undefined;
                expect(model.folder(new_unnamed.id).children).to.deep.equal([]);
                expect(model.folder(bms.outside.id).children).to.deep.equal([
                    bms.alice.id,
                    bms.separator.id,
                    bms.bob.id,
                    bms.empty.id,
                    new_unnamed.id,
                ]);
            });

            it('when moving bookmarks outside the stash root', async () => {
                const p = model.move(new_child.id, bms.names.id, 5);
                await events.next(browser.bookmarks.onMoved);
                await p;

                expect(model.folder(new_unnamed.id).children).to.deep.equal([]);
                expect(model.folder(bms.outside.id).children).to.deep.equal([
                    bms.alice.id,
                    bms.separator.id,
                    bms.bob.id,
                    bms.empty.id,
                    new_unnamed.id,
                ]);
                expect(model.folder(bms.names.id).children).to.deep.equal([
                    bms.doug_2.id,
                    bms.helen.id,
                    bms.patricia.id,
                    bms.nate.id,
                    new_child.id,
                ]);
            });
        });
    });
});
