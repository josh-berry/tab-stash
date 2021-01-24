import {expect} from 'chai';
import {Bookmarks, Tabs, Windows} from 'webextension-polyfill-ts';

import {urlToOpen} from '../util';

import * as M from './browser';

// XXX move me into a mock file, or remove me entirely and test with the actual
// favicon cache
class MockFaviconCache {
    cache: Map<string, M.FaviconCacheEntry>;
    constructor() {
        this.cache = new Map();
    }
    _entry(key: string): M.FaviconCacheEntry {
        let i = this.cache.get(key);
        if (! i) {
            i = {key, value: undefined, fetched: true};
            this.cache.set(key, i);
        }
        return i;
    }

    get(key: string): M.FaviconCacheEntry { return this._entry(key); }
    set(key: string, icon: string): M.FaviconCacheEntry {
        let i = this._entry(key);
        i.value = icon;
        return i;
    }
}

describe('model/browser', function() {
    //
    // This function defines all the invariants we expect to be true in the
    // model.
    //
    function check(model: M.StashState) {
        function check_related_index(url: string, items: M.ModelLeaf[])
        {
            for (let r of items) {
                expect(r.related,
                       `${r.id} to share related objects with ${url}`)
                    .to.equal(items);
                expect(r.url && urlToOpen(r.url),
                       `${r.id} to have the URL ${url}`)
                    .to.equal(url);

                if (r instanceof M.Bookmark) {
                    expect(r.isBookmark, `${r.id} to be a bookmark`).to.equal(true);
                    const dbbm = model.bms_by_id.get(r.id);
                    expect(r, `${r.id} to be indexed in bms_by_id`)
                        .to.equal(dbbm);
                } else /* istanbul ignore else */ if (r instanceof M.Tab) {
                    expect(r.isTab).to.equal(true);
                    const dbt = model.tabs_by_id.get(r.id);
                    expect(r, `${r.id} to be indexed in tabs_by_id`)
                        .to.equal(dbt);
                } else {
                    expect(true, `undefined value in related items for ${url}`)
                        .to.be.false;
                }
            }
        }

        function check_related(item: M.ModelLeaf) {
            if (item.url) {
                try {
                    const u = urlToOpen(item.url);
                    expect(item.favicon, `${item.id} has a Favicon object`)
                        .to.not.be.undefined;
                    expect(item.favicon, `${item.id} has the right Favicon`)
                        .to.equal(model.favicon_cache.get(u));
                } catch (e) {
                    // skip favicon check if URL isn't valid
                }

                expect(item.related, `${item.id} has a related index`)
                    .to.not.be.undefined;
                const rel = item.related!;

                const urldb = model.items_by_url.get(urlToOpen(item.url));
                expect(urldb, `${item.id}'s related index is in items_by_url`)
                    .to.equal(rel);

                expect(rel.includes(item),
                       `${item.id}'s related index contains itself`)
                    .to.equal(true);
            }
        }

        function check_bm(bm: M.Bookmark) {
            expect(bm.isBookmark, `${bm.id} is a bookmark`).to.equal(true);
            expect(bm.id, `${bm.title} has an ID`).to.be.a('string');
            expect(bm.title, `${bm.id} has a title`).to.be.a('string');
            if (bm.children === undefined) {
                // Not actually true: Separators can have undefined URLs and
                // undefined children.
                //expect(bm.url, `${bm.id} has a URL`).to.be.a('string');
            } else {
                expect(bm.url, `${bm.id} has no URL`).to.equal(undefined);
            }
            expect(bm.dateAdded, `${bm.id} has a date-added`).to.be.a('number');

            const dbbm = model.bms_by_id.get(bm.id);
            expect(bm, `${bm.id} to be indexed in bms_by_id`).to.equal(dbbm);

            if (bm.parent !== undefined) {
                const p = bm.parent;
                expect(p.children, `bm ${p.id} to have children`).to.not.be.undefined;
                expect(bm.index, `bm ${bm.id} to have an index`).to.not.be.undefined;
                expect(p.children![bm.index!],
                       `${bm.id} to be at index ${bm.index} in parent ${p.id}`)
                    .to.equal(bm);
            } else {
                expect(bm, `${bm.id} to be the root`).to.equal(model.bookmarks);
            }

            check_related(bm);
        }

        function check_bm_subtree(bm: M.Bookmark) {
            check_bm(bm);
            if (bm.children) {
                for (let i = 0; i < bm.children.length; ++i) {
                    const c = bm.children[i];
                    if (c === undefined) continue;
                    expect(c.parent, `${c.id}'s parent to be ${bm.id}`)
                        .to.equal(bm);
                    expect(c.index, `${c.id} to have index ${i}`).to.equal(i);
                    check_bm_subtree(c);
                }
            }
        }

        function check_tab(t: M.Tab) {
            expect(t.id, `tab ${t.title} has an ID`).to.be.a('number');
            expect(t.isTab, `tab ${t.id} is a tab`).to.equal(true);
            expect(t.title, `tab ${t.id} has a title`).to.be.a('string');
            expect(t.url, `tab ${t.id} has a URL`).to.be.a('string');
            expect(t.hidden, `tab ${t.id} has a hidden property`)
                .to.be.a('boolean');
            expect(t.active, `tab ${t.id} has an active property`)
                .to.be.a('boolean');
            expect(t.pinned, `tab ${t.id} has a pinned property`)
                .to.be.a('boolean');

            if (t.favIconUrl) {
                expect(t.favicon, `tab ${t.id} has a favicon`).to.not.be.undefined;
                // favicon origin is checked in check_related()
                expect(t.favicon!.value, `tab ${t.id} has the right favicon URL`)
                    .to.equal(t.favIconUrl);
            }

            if (t.favicon) {
                expect(t.favIconUrl, `tab ${t.id} has a favIconUrl`)
                    .to.be.a('string');
                // URL consistency checked above
            }

            const dbt = model.tabs_by_id.get(t.id);
            expect(t, `tab ${t.id} to be indexed in tabs_by_id`).to.equal(dbt);

            expect(t.parent, `tab ${t.id} has a parent`).to.not.be.undefined;
            const p = t.parent!;
            expect(p.children, `tab ${p.id} to have children`).to.not.be.undefined;
            expect(t.index, `tab ${t.id} to have an index`).to.not.be.undefined;
            expect(p.children![t.index!],
                   `tab ${t.id} to be at index ${t.index} in win ${p.id}`)
                .to.equal(t);

            check_related(t);
        }

        function check_win(w: M.Window) {
            expect(w.id, `win ${w} has an ID`).to.be.a('number');
            expect(w.isWindow, `win ${w.id} is a window`).to.equal(true);
            expect(w.focused, `win ${w.id} has a focused property`)
                .to.be.a('boolean');
            expect(w.type, `win ${w.id} has a type property`).to.be.a('string');

            const dbw = model.wins_by_id.get(w.id);
            expect(w, `win ${w.id} to be indexed in wins_by_id`).to.equal(dbw);

            for (let i = 0; i < w.children.length; ++i) {
                const c = w.children[i];
                // istanbul ignore if
                if (c === undefined) continue;
                expect(c.parent, `tab ${c.id} has win ${w.id} as its parent`)
                    .to.equal(w);
                expect(c.index, `tab ${c.id} is at index ${i}`).to.equal(i);
                check_tab(c);
            }
        }

        check_bm_subtree(model.bookmarks);
        for (let bm of model.bms_by_id.values()) check_bm(bm);
        for (let win of model.wins_by_id.values()) check_win(win);
        for (let tab of model.tabs_by_id.values()) check_tab(tab);
        for (let [url, items] of model.items_by_url.entries()) {
            check_related_index(url, items);
        }
    };

    const mktab = (t: Partial<Tabs.Tab>): Tabs.Tab => ({
        id: t.id,
        windowId: t.windowId || /* istanbul ignore next */ 0,
        index: t.index || 0,
        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl,
        active: t.active || false,
        hidden: t.hidden || false,
        pinned: t.pinned || false,
        highlighted: t.highlighted || false,
        incognito: t.incognito || false,
        isArticle: t.isArticle || false,
        isInReaderMode: t.isInReaderMode || false,
        lastAccessed: t.lastAccessed || 0,
    });

    const mkwin = (w: Partial<Windows.Window>,
                   tabs: Partial<Tabs.Tab>[]): Windows.Window =>
        ({
            id: w.id,
            focused: w.focused || false,
            top: w.top,
            left: w.left,
            width: w.width,
            height: w.height,
            tabs: ! tabs ? /* istanbul ignore next */ undefined
                : tabs.map((t, i) => {
                    t.windowId = w.id || 1;
                    t.index = i;
                    return mktab(t);
                }),
            incognito: w.incognito || false,
            type: w.type,
            state: w.state,
            alwaysOnTop: w.alwaysOnTop || false,
            sessionId: w.sessionId,
        });

    type BM = {
        id: string,
        parentId?: string,
        index?: number,
        title: string,
        url?: string,
        dateAdded?: number,
        children?: BM[],
    };
    const mkbm = (bm: BM): Bookmarks.BookmarkTreeNode => ({
        id: bm.id,
        parentId: bm.parentId,
        index: bm.index,
        title: bm.title,
        url: bm.url,
        dateAdded: bm.dateAdded || 0,
        type: bm.children ? 'folder'
            : (bm.url ? 'bookmark' : /* istanbul ignore next */ 'separator'),
        children: bm.children
            ? bm.children.map((c, i) => mkbm({
                id: c.id,
                parentId: bm.id,
                index: i,
                title: c.title,
                url: c.url,
                dateAdded: c.dateAdded,
                children: c.children,
              }))
            : undefined,
    });

    const OU = urlToOpen;

    function simple_state(): M.StashState {
        return new M.StashState(mkbm({
            id: 'root', title: 'Root', children: []
        }), [
            mkwin({id: 1, focused: true}, [
                {id: 1, title: 'Foo', url: 'http://1',
                 favIconUrl: 'favicon://foo', active: true},
            ]),
        ], new MockFaviconCache() as unknown as M.FaviconCache);
    }

    function fancy_state(): M.StashState {
        return new M.StashState(mkbm({
            id: 'root', title: 'Root',
            children: [
                {id: 'a', title: 'Folder A', children: [
                    {id: '1', title: 'Bookmark 1', url: 'http://1/bookmark'},
                     {id: '2', title: 'Bookmark 2', url: 'http://2/bookmark'},
                ]},
                {id: 'b', title: 'Bookmark B', url: 'http://b'},
                {id: 'c', title: 'Empty Folder C', children: []},
                {id: 'd', title: 'Folder D', children: [
                    {id: 'd1', title: 'Folder D1', children: []},
                    {id: 'd2', title: 'Folder D2', children: [
                        {id: 'd2a', title: 'D2A', url: 'http://d2a'},
                        {id: 'd2b', title: 'D2B', url: 'http://d2b'},
                        {id: 'd2c', title: 'D2C', url: 'http://d2c'},
                        {id: 'd2d', title: 'D2D', url: 'http://d2d'},
                        {id: 'dup1', title: 'Dup1', url: 'http://dup1'},
                        {id: 'd2e', title: 'D2E', url: 'http://d2e'},
                    ]},
                ]},
                {id: 'dup1-1', title: 'Dup 1 (1)', url: 'http://dup1'},
            ],
        }), [
            mkwin({id: 1, focused: true}, [
                {id: 1, title: 'Foo', url: 'http://1/bookmark',
                 favIconUrl: 'favicon://1/foo', active: true},
                {id: 2, title: 'Bar', url: 'http://bar/asdf',
                 favIconUrl: 'favicon://bar/foo'},
                {id: 3, title: 'Fred', url: 'http://fred/qwer',
                 favIconUrl: 'favicon://fred/foo'},
            ]),
            mkwin({id: 2}, [
                {id: 4, title: 'Foo', url: 'http://1/bookmark',
                 favIconUrl: 'favicon://1/foo', active: true, pinned: true},
                {id: 5, title: 'Bar', url: 'http://bar/qwer',
                 favIconUrl: 'favicon://bar/foo'},
                {id: 6, title: 'Fred', url: 'http://fred/asdf',
                 favIconUrl: 'favicon://fred/foo'},
                {id: 7, title: 'Hidden', url: 'http://2/path',
                 favIconUrl: 'favicon://2/foo'},
                {id: 8, title: 'Hidden', url: 'http://2/bookmark',
                 favIconUrl: 'favicon://2/foo'},
                {id: 10, title: 'Sparse', url: 'http://sparse/testing',
                 favIconUrl: 'favicon://sparse/icon'},
            ]),
        ], new MockFaviconCache() as unknown as M.FaviconCache);
    }

    describe('construction', function() {
        it('can be constructed with a pre-existing state', function() {
            let model = fancy_state();
            check(model);
        });
    });

    describe('bookmarks', function() {
        let model: M.StashState;
        beforeEach(function() {
            model = simple_state();
            check(model);
            expect(model.bookmarks).to.equal(model.bms_by_id.get('root'));
        });

        it('creates/updates bookmarks', function() {
            for (let _ of [0, 1, 2]) {
                model._bookmark('new')._update({
                    id: 'new', parentId: 'root', index: 0, dateAdded: 1,
                    title: 'New Title', url: 'http://new'});
                check(model);
                expect(model.bms_by_id.get('new')).to.include({
                    isBookmark: true,
                    id: 'new',
                    title: 'New Title',
                    parent: model.bms_by_id.get('root'),
                    index: 0,
                });
            }
        });

        it('distinguishes empty folders from leaf bookmarks', function() {
            model._bookmark('new')._update({
                id: 'new', parentId: 'root', index: 0, dateAdded: 1,
                title: 'Empty Folder', type: 'folder'});
            check(model);
            expect(model.bms_by_id.get('new')).to.deep.include({
                children: [],
            });
        });

        it('creates/updates subtrees of bookmarks', function() {
            for (let _ of [0, 1, 2]) {
                model._bookmark('parent')._update({
                    id: 'parent', parentId: 'root', index: 0, dateAdded: 1,
                    title: 'Parent Folder', children: [
                        {id: 'child1', title: 'Child 1', dateAdded: 2,
                         url: 'url-child1'},
                        {id: 'child2', title: 'Child 2', dateAdded: 2,
                         url: 'url-child2'},
                        {id: 'new', title: 'New Title', dateAdded: 2,
                         url: 'http://new'},
                    ]});
                check(model);
                expect(model.bms_by_id.get('parent')).to.include({
                    isBookmark: true, id: 'parent', title: 'Parent Folder',
                    parent: model.bms_by_id.get('root'), index: 0,
                });
                expect(model.bms_by_id.get('child1')).to.include({
                    isBookmark: true, id: 'child1', title: 'Child 1',
                    parent: model.bms_by_id.get('parent'), index: 0,
                });
                expect(model.bms_by_id.get('child2')).to.include({
                    isBookmark: true, id: 'child2', title: 'Child 2',
                    parent: model.bms_by_id.get('parent'), index: 1,
                });
            }
        });

        it('shifts indexes right when inserting new children', function() {
            model._bookmark('new')._update({
                parentId: 'root', index: 0, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            check(model);
            expect(model.bms_by_id.get('new')!.index).to.equal(0);
            model._bookmark('new2')._update({
                parentId: 'root', index: 1, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            expect(model.bms_by_id.get('new')!.index).to.equal(0);
            expect(model.bms_by_id.get('new2')!.index).to.equal(1);
            check(model);
            model._bookmark('new3')._update({
                parentId: 'root', index: 0, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            expect(model.bms_by_id.get('new')!.index).to.equal(1);
            expect(model.bms_by_id.get('new2')!.index).to.equal(2);
            expect(model.bms_by_id.get('new3')!.index).to.equal(0);
            check(model);
        });

        it('moves bookmarks within a folder', function() {
            model._bookmark('parent')._update({
                id: 'parent', parentId: 'root', index: 0, dateAdded: 1,
                title: 'Parent Folder', children: [
                    {id: 'child1', title: 'Child 1', dateAdded: 2,
                     url: 'url-child1'},
                    {id: 'child2', title: 'Child 2', dateAdded: 2,
                     url: 'url-child2'},
                    {id: 'new', title: 'New Title', dateAdded: 2,
                     url: 'http://new'},
                ]});
            check(model);
            expect(model.bms_by_id.get('new')).to.include({
                isBookmark: true, id: 'new', title: 'New Title',
                parent: model.bms_by_id.get('parent'), index: 2,
            });

            for (let _ of [0, 1, 2]) {
                model._bookmark('new')._update({index: 1});
                check(model);
                expect(model.bms_by_id.get('new')).to.include({
                    isBookmark: true, id: 'new', title: 'New Title',
                    parent: model.bms_by_id.get('parent'), index: 1,
                });
            }
        });

        it('moves bookmarks to a new folder', function() {
            model._bookmark('parent')._update({
                id: 'parent', parentId: 'root', index: 0, dateAdded: 1,
                title: 'Parent Folder', children: [
                    {id: 'child1', title: 'Child 1', dateAdded: 2,
                     url: 'url-child1'},
                    {id: 'child2', title: 'Child 2', dateAdded: 2,
                     url: 'url-child2'},
                    {id: 'new', title: 'New Title', dateAdded: 2,
                     url: 'http://new'},
                ]});
            check(model);
            expect(model.bms_by_id.get('new')).to.include({
                isBookmark: true,
                id: 'new',
                title: 'New Title',
                parent: model.bms_by_id.get('parent'),
                index: 2,
            });

            for (let _ of [0, 1, 2]) {
                model._bookmark('new')._update({parentId: 'root', index: 1});
                check(model);
                expect(model.bms_by_id.get('new')).to.include({
                    isBookmark: true, id: 'new', title: 'New Title',
                    parent: model.bms_by_id.get('root'), index: 1,
                });
            }
        });

        it('updates bookmark titles/URLs', function() {
            model._bookmark('new')._update({
                parentId: 'root', index: 0, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            check(model);
            expect(model.bms_by_id.get('new')).to.include({
                id: 'new', isBookmark: true, title: 'Foo', url: 'foo',
                parent: model.bms_by_id.get('root'), index: 0,
            });

            for (let _ of [0, 1, 2]) {
                model._bookmark('new')._update({title: 'Bar', url: 'bar'});
                check(model);
                expect(model.bms_by_id.get('new')).to.include({
                    id: 'new', isBookmark: true, title: 'Bar', url: 'bar',
                    parent: model.bms_by_id.get('root'), index: 0,
                });
            }
        });

        it('removes bookmarks', function() {
            model._bookmark('new')._update({
                parentId: 'root', index: 0, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            check(model);
            expect(model.bms_by_id.get('new'), `bms_by_id before remove`)
                .to.include({
                    id: 'new', isBookmark: true, title: 'Foo', url: 'foo',
                    parent: model.bms_by_id.get('root'), index: 0,
                });
            expect(model.items_by_url.get(OU('foo')), `items_by_url before remove`)
                .to.eql([model.bms_by_id.get('new')]);

            model._bookmark('new')._remove();
            expect(model.bms_by_id.get('new'), `bms_by_id after remove`)
                .to.equal(undefined);
            expect(model.bookmarks.children, `children after remove`)
                .to.deep.equal([]);
            expect(model.items_by_url.get(OU('foo')), `items_by_url after remove`)
                .to.equal(undefined);
            check(model);
        });

        it('removes folders and their children', function() {
            model._bookmark('new')._update({
                parentId: 'root', index: 0, title: 'Foo',
                dateAdded: 1, children: [
                    {id: 'child1', title: 'Child 1', url: 'child1',
                     dateAdded: 2},
                    {id: 'f1', title: 'Folder 1', dateAdded: 2, children: [
                        {id: 'child2', title: 'Child 2', url: 'child2',
                         dateAdded: 2},
                    ]},
                    {id: 'child3', title: 'Child 3', url: 'child3',
                     dateAdded: 2},
                ],
            });
            // We are assuming that the insertion was successful because there's
            // another test for that.
            check(model);
            model._bookmark('new')._remove();
            expect(model.bms_by_id.get('new')).to.equal(undefined);
            expect(model.bms_by_id.get('child1')).to.equal(undefined);
            expect(model.bms_by_id.get('child2')).to.equal(undefined);
            expect(model.bms_by_id.get('child3')).to.equal(undefined);
            expect(model.bms_by_id.get('f1')).to.equal(undefined);
            expect(model.bookmarks.children).to.deep.equal([]);
            check(model);
        });

        it('shifts indexes left when removing children', function() {
            model._bookmark('new')._update({
                parentId: 'root', index: 0, title: 'Foo',
                dateAdded: 1, children: [
                    {id: 'child1', title: 'Child 1', url: 'child1',
                     dateAdded: 2},
                    {id: 'child2', title: 'Child 2', url: 'child2',
                     dateAdded: 2},
                    {id: 'child3', title: 'Child 3', url: 'child3',
                     dateAdded: 2},
                    {id: 'child4', title: 'Child 4', url: 'child3',
                     dateAdded: 2},
                ],
            });
            expect(model.bms_by_id.get('child1')!.index).to.equal(0);
            expect(model.bms_by_id.get('child2')!.index).to.equal(1);
            expect(model.bms_by_id.get('child3')!.index).to.equal(2);
            expect(model.bms_by_id.get('child4')!.index).to.equal(3);
            check(model);

            model._bookmark('child1')._remove();
            expect(model.bms_by_id.get('child1')).to.equal(undefined);
            expect(model.bms_by_id.get('child2')!.index).to.equal(0);
            expect(model.bms_by_id.get('child3')!.index).to.equal(1);
            expect(model.bms_by_id.get('child4')!.index).to.equal(2);
            check(model);

            model._bookmark('child3')._remove();
            expect(model.bms_by_id.get('child1')).to.equal(undefined);
            expect(model.bms_by_id.get('child2')!.index).to.equal(0);
            expect(model.bms_by_id.get('child3')).to.equal(undefined);
            expect(model.bms_by_id.get('child4')!.index).to.equal(1);
            check(model);
        });
    });

    describe('windows and tabs', function() {
        let model: M.StashState;
        beforeEach(function() {
            model = simple_state();
            check(model);
            expect(model.bookmarks).to.equal(model.bms_by_id.get('root'));
        });

        it('creates windows with pre-populated tabs', function() {
            model._window(2)._update(mkwin({focused: true}, [
                {id: 2, title: 'Tab 1',
                 url: 'http://url1', favIconUrl: 'http://fav1',
                 hidden: false, active: false, pinned: false},
                {id: 3, title: 'Tab 2',
                 url: 'http://url2', favIconUrl: 'http://fav2',
                 hidden: false, active: false, pinned: false},
            ]));
            expect(model.wins_by_id.get(2)).to.deep.include({
                isWindow: true,
                id: 2, focused: true, type: 'normal', children: [
                    model.tabs_by_id.get(2),
                    model.tabs_by_id.get(3),
                ]});
            expect(model.tabs_by_id.get(2)).to.include({
                id: 2, title: 'Tab 1',
                url: 'http://url1', favIconUrl: 'http://fav1',
                hidden: false, active: false, pinned: false, isTab: true,
                parent: model.wins_by_id.get(2), index: 0,
            });
            expect(model.tabs_by_id.get(3)).to.include({
                id: 3, title: 'Tab 2',
                url: 'http://url2', favIconUrl: 'http://fav2',
                hidden: false, active: false, pinned: false, isTab: true,
                parent: model.wins_by_id.get(2), index: 1,
            });
            expect(model.tabs_by_id.get(2)!.parent)
                .to.equal(model.wins_by_id.get(2));
            expect(model.tabs_by_id.get(3)!.parent)
                .to.equal(model.wins_by_id.get(2));
            check(model);
        });

        it('removes windows and their associated tabs', function() {
            expect(model.wins_by_id.get(1)).to.include({id: 1});
            expect(model.tabs_by_id.get(1)).to.include({id: 1});
            model._window(1)._remove();
            expect(model.tabs_by_id.get(1)).to.equal(undefined);
            expect(model.wins_by_id.get(1)).to.equal(undefined);
            check(model);
        });

        it('creates tabs and inserts them into windows in the right place',
           function() {
               expect(model.wins_by_id.get(1)).to.include({id: 1});
               expect(model.tabs_by_id.get(1)).to.include({id: 1, index: 0});

               model._tab(2)._update({
                   id: 2, windowId: 1, index: 1, title: 'New Tab',
                   url: 'http://newtab', favIconUrl: 'http://favicon',
                   hidden: false, active: true, pinned: false,
                   status: 'complete',
               });
               expect(model.tabs_by_id.get(2)).to.include({
                   id: 2, parent: model.wins_by_id.get(1), index: 1,
                   title: 'New Tab',
                   url: 'http://newtab', favIconUrl: 'http://favicon',
                   hidden: false, active: true, pinned: false
               });
               expect(model.wins_by_id.get(1)).to.deep.include({
                   children: [
                       model.tabs_by_id.get(1),
                       model.tabs_by_id.get(2),
                   ]});
               check(model);

               model._tab(3)._update({
                   id: 3, windowId: 1, index: 0, title: 'First Tab',
                   url: 'http://first', favIconUrl: 'http://first',
                   hidden: false, active: false, pinned: false,
                   status: 'complete',
               });
               expect(model.tabs_by_id.get(3)).to.include({
                   id: 3, parent: model.wins_by_id.get(1), index: 0,
                   title: 'First Tab',
                   url: 'http://first', favIconUrl: 'http://first',
                   hidden: false, active: false, pinned: false,
               });
               expect(model.wins_by_id.get(1)).to.deep.include({
                   children: [
                       model.tabs_by_id.get(3),
                       model.tabs_by_id.get(1),
                       model.tabs_by_id.get(2),
                   ]});
               check(model);
           });

        function move_remove_tab_state() {
            expect(model.wins_by_id.get(1)).to.include({id: 1});
            expect(model.tabs_by_id.get(1)).to.include({id: 1, index: 0});

            model._tab(2)._update({
                id: 2, windowId: 1, index: 1, title: 'New Tab',
                url: 'http://newtab', favIconUrl: 'http://favicon',
                hidden: false, active: true, pinned: false,
                status: 'complete',
            });
            model._tab(3)._update({
                id: 3, windowId: 1, index: 2, title: 'New Tab #2',
                url: 'http://newtab2', favIconUrl: 'http://favicon',
                hidden: false, active: true, pinned: false,
                status: 'complete',
            });
            model._tab(4)._update({
                id: 4, windowId: 1, index: 3, title: 'New Tab #3',
                url: 'http://newtab3', favIconUrl: 'http://favicon',
                hidden: false, active: true, pinned: false,
                status: 'complete',
            });
            check(model);
        }

        it('removes tabs from their parent windows', function() {
            move_remove_tab_state();

            model._tab(4)._remove();
            expect(model.wins_by_id.get(1)!.children).to.deep.equal([
                model.tabs_by_id.get(1),
                model.tabs_by_id.get(2),
                model.tabs_by_id.get(3),
            ]);
            check(model);

            model._tab(2)._remove();
            expect(model.wins_by_id.get(1)!.children).to.deep.equal([
                model.tabs_by_id.get(1),
                model.tabs_by_id.get(3),
            ]);
            check(model);

            model._tab(1)._remove();
            expect(model.wins_by_id.get(1)!.children).to.deep.equal([
                model.tabs_by_id.get(3),
            ]);
            check(model);
        });

        it('moves tabs within a window', function() {
            move_remove_tab_state();

            model._tab(4)._update({windowId: 1, index: 0});
            expect(model.tabs_by_id.get(4)!.index).to.equal(0);
            expect(model.tabs_by_id.get(1)!.index).to.equal(1);
            expect(model.tabs_by_id.get(2)!.index).to.equal(2);
            expect(model.tabs_by_id.get(3)!.index).to.equal(3);
            check(model);

            model._tab(4)._update({windowId: 1, index: 3});
            expect(model.tabs_by_id.get(1)!.index).to.equal(0);
            expect(model.tabs_by_id.get(2)!.index).to.equal(1);
            expect(model.tabs_by_id.get(3)!.index).to.equal(2);
            expect(model.tabs_by_id.get(4)!.index).to.equal(3);
            check(model);

            model._tab(3)._update({windowId: 1, index: 1});
            expect(model.tabs_by_id.get(1)!.index).to.equal(0);
            expect(model.tabs_by_id.get(3)!.index).to.equal(1);
            expect(model.tabs_by_id.get(2)!.index).to.equal(2);
            expect(model.tabs_by_id.get(4)!.index).to.equal(3);
            check(model);
        });

        it('moves tabs between windows', function() {
            move_remove_tab_state();
            model._window(2)._update(mkwin({}, [
                {id: 5, title: 'Mambo #5', url: 'http://mambo',
                 favIconUrl: 'http://mambo',
                 hidden: false, active: false, pinned: false},
                {id: 6, title: 'words long', url: 'http://words',
                 favIconUrl: 'http://words',
                 hidden: false, active: false, pinned: false},
            ]));
            check(model);

            model._tab(4)._update({windowId: 2, index: 2});
            expect(model.tabs_by_id.get(1)!.index).to.equal(0);
            expect(model.tabs_by_id.get(2)!.index).to.equal(1);
            expect(model.tabs_by_id.get(3)!.index).to.equal(2);
            expect(model.tabs_by_id.get(5)!.index).to.equal(0);
            expect(model.tabs_by_id.get(6)!.index).to.equal(1);
            expect(model.tabs_by_id.get(4)!.parent).to.equal(
                model.wins_by_id.get(2));
            expect(model.tabs_by_id.get(4)!.index).to.equal(2);
            check(model);

            model._tab(6)._update({windowId: 1, index: 0});
            expect(model.tabs_by_id.get(6)!.parent).to.equal(
                model.wins_by_id.get(1));
            expect(model.tabs_by_id.get(6)!.index).to.equal(0);
            expect(model.tabs_by_id.get(1)!.index).to.equal(1);
            expect(model.tabs_by_id.get(2)!.index).to.equal(2);
            expect(model.tabs_by_id.get(3)!.index).to.equal(3);
            expect(model.tabs_by_id.get(5)!.index).to.equal(0);
            expect(model.tabs_by_id.get(4)!.parent).to.equal(
                model.wins_by_id.get(2));
            expect(model.tabs_by_id.get(4)!.index).to.equal(1);
            check(model);
        });

        it('replaces tabs with new IDs', function() {
            expect(model.tabs_by_id.get(1)!.id).to.equal(1);

            model._tab_replaced(2, 1);
            expect(model.tabs_by_id.get(1)).to.equal(undefined);
            expect(model.tabs_by_id.get(2)!.id).to.equal(2);
            expect(model.tabs_by_id.get(2)!.url).to.equal('http://1');
            expect(model.wins_by_id.get(1)).to.deep.include({
                children: [
                    model.tabs_by_id.get(2),
                ],
            });
            check(model);
        });

        it('updates tab URLs', function() {
            expect(model.tabs_by_id.get(1)!.url).to.equal('http://1');
            expect(model.items_by_url.get(OU('http://1'))).to.contain(
                model.tabs_by_id.get(1)!);

            model._tab(1)._update({id: 1, url: 'bar://', status: 'complete'});
            expect(model.tabs_by_id.get(1)!.url).to.equal('bar://');
            expect(model.items_by_url.get(OU('http://1'))).to.equal(undefined);
            expect(model.items_by_url.get(OU('bar://'))).to.contain(
                model.tabs_by_id.get(1)!);
            check(model);
        });

        it('updates tab titles', function() {
            expect(model.tabs_by_id.get(1)!.title).to.equal('Foo');
            model._tab(1)._update({id: 1, title: 'Bar'});
            expect(model.tabs_by_id.get(1)!.title).to.equal('Bar');
            check(model);
        });
    });

    describe('related bookmarks', function() {
        let model: M.StashState;
        beforeEach(function() {
            model = simple_state();
            check(model);
            model._bookmark('1')._update({url: 'http://1', title: '1',
                                        dateAdded: 1,
                                        parentId: 'root', index: 0});
            model._bookmark('1prime')._update({url: 'http://1', title: '1-prime',
                                             dateAdded: 2,
                                             parentId: 'root', index: 1});
            model._bookmark('2')._update({id: '2', url: 'http://2', title: '2',
                                        dateAdded: 3,
                                        parentId: 'root', index: 2});
            expect(model.items_by_url.get(OU('http://1'))).to.include.members([
                model.bms_by_id.get('1'),
                model.bms_by_id.get('1prime'),
            ]);
        });

        it('links duplicate bookmarks together', function() {
            check(model);
        });

        it('unlinks a duplicate bookmark when it is deleted', function() {
            model._bookmark('1prime')._remove();
            expect(model.items_by_url.get(OU('http://1'))).to.include.members([
                model.bms_by_id.get('1'),
            ]);
            check(model);
        });

        it('moves a bookmark from one URL set to another when its URL changes',
           function() {
               model._bookmark('1prime')._update({url: 'http://2'});
               expect(model.items_by_url.get(OU('http://1'))).to.include
                   .members([model.bms_by_id.get('1')]);
               expect(model.items_by_url.get(OU('http://2'))).to.include
                   .members([
                       model.bms_by_id.get('2'),
                       model.bms_by_id.get('1prime'),
                   ]);
               check(model);
           });
    });

    describe('related bookmarks and tabs', function() {
        let model: M.StashState;
        beforeEach(function() {
            model = fancy_state();
            check(model);
        });

        it('links duplicate tabs together', function() {
            expect(model.items_by_url.get(OU('http://1/bookmark')))
                .to.include.members([
                    model.bms_by_id.get('1'),
                    model.tabs_by_id.get(1),
                    model.tabs_by_id.get(4),
                ]);
        });

        it('links bookmarks with tabs with the same URLs', function() {
            expect(model.items_by_url.get(OU('http://2/bookmark')))
                .to.include.members([
                    model.bms_by_id.get('2'),
                    model.tabs_by_id.get(8),
                ]);
        });

        it('unlinks a tab when it is closed', function() {
            model._tab(3)._remove();
            expect(model.items_by_url.get(OU('http://1/bookmark')))
                .to.include.members([
                    model.bms_by_id.get('1'),
                    model.tabs_by_id.get(1),
                ]);
            check(model);
        });

        it('moves a tab from one URL set to another when its URL changes',
           function() {
               model._tab(7)._update({id: 7, url: 'http://newtab',
                                      status: 'complete'});
               expect(model.items_by_url.get(OU('http://1/bookmark')))
                   .to.include.members([
                       model.bms_by_id.get('1'),
                       model.tabs_by_id.get(1),
                   ]);
               expect(model.items_by_url.get(OU('http://newtab')))
                   .to.include.members([model.tabs_by_id.get(7)]);
               check(model);
           });

        it('relates about:reader URLs to their actual URLs', function() {
            model._tab(10)._update({
                id: 10, windowId: 1, index: 3, status: 'complete',
                url: "about:reader?url=http%3A%2F%2Ffoo.bar%2Fpath#a",
                title: 'Reader Mode',
                favIconUrl: 'favicon://none'});
            model._bookmark('non-reader')._update({
                id: 'non-reader', parentId: 'root', index: 5,
                title: 'Non reader mode URL',
                url: 'http://foo.bar/path#a',
                dateAdded: 2,
            });
            expect(model.items_by_url.get(OU('http://foo.bar/path#a')))
                .to.include.members([
                    model.tabs_by_id.get(10),
                    model.bms_by_id.get('non-reader'),
                ]);
            check(model);
        });
    });

    describe('related favicons and tabs/bookmarks', function() {
        let model: M.StashState;
        beforeEach(function() {
            model = simple_state();
            check(model);
        });

        it('relates bookmark favicons to the correct tab favicons', function() {
            model._tab(42)._update({
                id: 42, windowId: 42, index: 0, status: 'complete',
                title: 'Google',
                url: 'http://google.com/some-url',
                favIconUrl: 'http://google.com/favicon.ico'});
            model._bookmark('goog')._update({
                id: 'goog', parentId: 'root', index: 5,
                title: 'Google',
                dateAdded: 42,
                url: 'http://google.com/some-url',
            });
            model._bookmark('fb')._update({
                id: 'fb', parentId: 'root', index: 6,
                title: 'Facebook',
                dateAdded: 42,
                url: 'http://facebook.com/some-other-url',
            });

            expect(model._bookmark('goog').favicon)
                .to.equal(model._tab(42).favicon);
            expect(model._bookmark('fb').favicon)
                .to.not.equal(model._tab(42).favicon);
            check(model);

            model._tab(42)._update({
                url: 'http://facebook.com/some-other-url',
                favIconUrl: 'http://facebook.com/favicon.ico',
                status: 'complete',
            });

            expect(model._bookmark('goog').favicon)
                .to.not.equal(model._tab(42).favicon);
            expect(model._bookmark('fb').favicon)
                .to.equal(model._tab(42).favicon);
            check(model);
        });

        it('updates favicons correctly when navigating between tabs',
           function() {
               model._tab(42)._update({
                   id: 42, windowId: 42, index: 0, title: 'Amabook',
                   url: "http://amabook.com",
                   favIconUrl: "http://amabook.com/favicon.ico",
                   status: 'complete',
               });
               check(model);

               // NOTE: we omit the check() call in the following two mutations
               // because status: 'loading' tabs violate the invariant that the
               // favicon cache has the correct icon for the tab.  This is
               // because 'loading' is technically an intermediate state where
               // the URL and favicons may not match.  We still check all the
               // invariants at the end of the test once everything should have
               // converged.

               model._tab(42)._update({
                   id: 42, windowId: 42, index: 0, title: 'Amabook',
                   url: "http://faceazon.com",
                   favIconUrl: "http://amabook.com/favicon.ico",
                   status: 'loading',
               });
               expect(model.favicon_cache.get('http://amabook.com'))
                   .to.deep.include({
                       value: "http://amabook.com/favicon.ico"
                   });
               expect(model.favicon_cache.get('http://faceazon.com'))
                   .to.deep.include({value: undefined});
               //check(model);

               model._tab(42)._update({
                   id: 42, windowId: 42, index: 0, title: 'Amabook',
                   url: "http://faceazon.com",
                   favIconUrl: "http://faceazon.com/favicon.ico",
                   status: 'loading',
               });
               expect(model.favicon_cache.get('http://amabook.com'))
                   .to.deep.include({
                       value: "http://amabook.com/favicon.ico"
                   });
               expect(model.favicon_cache.get('http://faceazon.com'))
                   .to.deep.include({value: undefined});
               //check(model);

               model._tab(42)._update({
                   id: 42, windowId: 42, index: 0, title: 'Amabook',
                   url: "http://faceazon.com",
                   favIconUrl: "http://faceazon.com/favicon.ico",
                   status: 'complete',
               });
               expect(model.favicon_cache.get('http://amabook.com'))
                   .to.deep.include({
                       value: "http://amabook.com/favicon.ico"
                   });
               expect(model.favicon_cache.get('http://faceazon.com'))
                   .to.deep.include({
                       value: "http://faceazon.com/favicon.ico"
                   });
               check(model);
           });
    });
});
