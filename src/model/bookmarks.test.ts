import {expect} from 'chai';
import {nextTick} from '../util';

import * as M from './bookmarks';

function setIndexes(bm: M.Bookmark) {
    if (! bm.children) return;
    let i = 0;
    for (const c of bm.children) {
        c.parentId = bm.id;
        c.index = i;
        setIndexes(c);
        ++i;
    }
}

const BMS: {[k: string]: M.Bookmark} = {
    foo: {id: 'foo', title: 'Foo', url: '/foo'},
    foo2: {id: 'foo2', title: 'Foo', url: '/foo'}, // a duplicate
    bar: {id: 'bar', title: 'Bar', url: '/bar'},
    ok: {id: 'ok', title: 'Okay', url: '/ok'},
    a: {id: 'a', title: 'a', url: '/a'},
    b: {id: 'b', title: 'b', url: '/b'},
    c: {id: 'c', title: 'c', url: '/c'},
    d: {id: 'd', title: 'd', url: '/d'},
    sep: {id: 'sep', title: '', type: 'separator'}, // for Firefox
};

// a Chrome-style empty folder (other folders are also chrome-style)
BMS.empty = {id: 'empty', title: 'Empty Folder'};

// a Firefox-style folder
BMS.likes = {id: 'likes', title: 'Likes', type: 'folder', children: [
    BMS.foo,
    BMS.bar,
]};

BMS.tools = {id: 'tools', title: 'Toolbar', children: [BMS.likes, BMS.ok]};

BMS.subfolder = {id: 'subfolder', title: 'Subfolder', children: [
    BMS.b,
    BMS.c,
    BMS.d,
]};

BMS.menu = {id: 'menu', title: 'Menu', children: [
    BMS.foo2,
    BMS.empty,
    BMS.sep,
    BMS.a,
    BMS.subfolder,
]};

// index needs to be set here because the parentId is undefined, which is still
// technically a value and still gets indexed...
BMS.root = {id: 'root', title: 'Root', index: 0, children: [
    BMS.tools,
    BMS.menu,
]};

setIndexes(BMS.root);

describe('model/bookmarks', () => {
    // Massage our input slightly for testing against, to handle the Chrome
    // empty folder special case (since the model ensures that folders always
    // have a 'children' property, but Chrome doesn't necessarily do this).
    const bms = JSON.parse(JSON.stringify(BMS));
    bms.empty.children = [];
    bms.menu.children[1] = bms.empty;
    bms.root.children[1] = bms.menu;

    let model: M.Model;

    beforeEach(async () => {
        // Typically bookmarks are loaded as a whole tree, so that's what we do
        // here.
        model = M.Model.for_test(JSON.parse(JSON.stringify(BMS.root)));
        await nextTick();
    });

    describe('creates bookmarks from a tree', () => {
        it('creates the right bookmark objects', () => {
            for (const l in bms) {
                expect(model.by_id.get(l), l).to.deep.equal(bms[l]);
            }
        });

        it('creates leaf folders correctly', () => {
            for (const l in bms) {
                const bm = bms[l];
                if (! bm.children) continue;
                expect(model.by_parent.get(l), l).to.deep.equal(bm.children);
            }
        });

        it('indexes URLs correctly', () => {
            expect(model.by_url.get('/foo')).to.deep.equal([BMS.foo, BMS.foo2]);
            expect(model.by_url.get('/a')).to.deep.equal([BMS.a]);
        });
    });

    it('inserts bookmarks into the tree', async () => {
        const bm = {id: 'new', title: 'New', url: '/new', parentId: 'tools', index: 2};
        model.whenBookmarkCreated(bm.id, JSON.parse(JSON.stringify(bm)));
        await nextTick();

        expect(model.by_id.get('new'), 'by_id').to.deep.equal(bm);
        expect(model.by_url.get('/new'), 'by_url').to.deep.equal([bm]);
        expect(model.by_parent.get('tools'), 'by_parent').to.deep.equal([
            BMS.likes,
            BMS.ok,
            bm
        ]);
    });

    it('inserts duplicate bookmarks gracefully', async () => {
        const new_b = {...BMS.b, title: 'The New A', url: '/new_a'};
        model.whenBookmarkCreated(new_b.id, JSON.parse(JSON.stringify(new_b)));
        await nextTick();

        expect(model.by_id.get('b')).to.deep.equal(new_b);
        expect(model.by_url.get('/b')).to.deep.equal([]);
        expect(model.by_url.get('/new_a')).to.deep.equal([new_b]);
        expect(model.by_parent.get('subfolder')).to.deep.equal([
            new_b,
            BMS.c,
            BMS.d,
        ]);
    });

    it('updates bookmarks', async () => {
        const new_b = {...BMS.b, title: 'The New A', url: '/new_a'};
        model.whenBookmarkChanged('b', {title: new_b.title, url: new_b.url});
        await nextTick();

        expect(model.by_id.get('b')).to.deep.equal(new_b);
        expect(model.by_url.get('/b')).to.deep.equal([]);
        expect(model.by_url.get('/new_a')).to.deep.equal([new_b]);
        expect(model.by_parent.get('subfolder')).to.deep.equal([
            new_b,
            BMS.c,
            BMS.d,
        ]);
    });

    it('updates folder titles', async () => {
        const sub = {...BMS.subfolder, title: 'Secret'};
        model.whenBookmarkChanged('subfolder', {title: 'Secret'});
        await nextTick();
        expect(model.by_id.get('subfolder')).to.deep.equal(sub);
    });

    it('removes bookmarks idempotently', async () => {
        for (let t = 0; t < 2; ++t) {
            model.whenBookmarkRemoved('b');
            await nextTick();

            expect(model.by_id.get('b')).to.be.undefined;
            expect(model.by_url.get('/b')).to.deep.equal([]);
            expect(model.by_parent.get('subfolder')).to.deep.equal([
                {...BMS.c, index: 0},
                {...BMS.d, index: 1},
            ]);
        }
    });

    it('removes folders idempotently', async () => {
        for (let t = 0; t < 2; ++t) {
            model.whenBookmarkRemoved('menu');
            await nextTick();

            expect(model.by_id.get('menu')).to.be.undefined;
            expect(model.by_id.get('a')).to.be.undefined;
            expect(model.by_id.get('subfolder')).to.be.undefined;
            expect(model.by_url.get('/a')).to.deep.equal([]);
            expect(model.by_url.get('/b')).to.deep.equal([]);
            expect(model.by_parent.get('subfolder')).to.deep.equal([]);
            expect(model.by_parent.get('menu')).to.deep.equal([]);
            expect(model.by_parent.get('root')).to.deep.equal([BMS.tools]);
        }
    });

    it('moves bookmarks', async () => {
        const loc = {parentId: 'root', index: 1};
        const new_a = {...bms.a, ...loc};
        const new_menu = {...bms.menu, index: 2, children: [
            {...bms.foo2, index: 0},
            {...bms.empty, index: 1},
            {...bms.sep, index: 2},
            {...bms.subfolder, index: 3},
        ]};

        model.whenBookmarkMoved('a', loc);
        await nextTick();

        expect(model.by_id.get('a')).to.deep.include(loc);
        expect(model.by_parent.get('root')).to.deep.equal([
            bms.tools,
            new_a,
            new_menu,
        ]);
        expect(model.by_parent.get('menu')).to.deep.equal(new_menu.children);
    });
});
