import * as M from './model';

describe('model', function() {
    //
    // This function defines all the invariants we expect to be true in the
    // model.
    //
    function check(model) {
        function check_related_index(url, items) {
            for (let r of items) {
                expect(r.related, `${r.id} to share related objects with ${url}`)
                    .to.equal(items);
                expect(r.url, `${r.id} to have the URL ${url}`)
                    .to.equal(url);

                if (r.isBookmark) {
                    const dbbm = model.bms_by_id.get(r.id);
                    expect(r, `${r.id} to be indexed in bms_by_id`)
                        .to.equal(dbbm);
                } else if (r.isTab) {
                    const dbt = model.tabs_by_id(r.id);
                    expect(r, `${r.id} to be indexed in tabs_by_id`)
                        .to.equal(dbt);
                } else {
                    expect(r.isBookmark, `${r.id} to be a bookmark or tab`)
                        .to.equal(true);
                }
            }
        }

        function check_related(item) {
            if (item.url) {
                expect(item.related, `${item.id} has a related index`)
                    .to.not.be.undefined;

                const urldb = model.items_by_url.get(item.url);
                expect(urldb, `${item.id}'s related index is in items_by_url`)
                    .to.equal(item.related);

                expect(item.related.includes(item), `${item.id}'s related index contains itself`).to.equal(true);
            }
        }

        function check_bm(bm) {
            expect(bm.isBookmark, `${bm.id} is a bookmark`).to.equal(true);
            expect(bm.id, `${bm.title} has an ID`).to.be.a('string');
            expect(bm.title, `${bm.id} has a title`).to.be.a('string');
            if (! bm.children) {
                expect(bm.url, `${bm.id} has a URL`).to.be.a('string');
            } else {
                expect(bm.url, `${bm.id} has no URL`).to.equal(undefined);
            }
            expect(bm.dateAdded, `${bm.id} has a date-added`).to.be.a('number');

            const dbbm = model.bms_by_id.get(bm.id);
            expect(bm, `${bm.id} to be indexed in bms_by_id`).to.equal(dbbm);

            if (bm.parent) {
                const p = bm.parent;
                expect(p.children[bm.index], `${bm.id} to be at index ${bm.index} in parent ${p.id}`).to.equal(bm);
            } else {
                expect(bm, `${bm.id} to be the root`).to.equal(model.bookmarks);
            }

            check_related(bm);
        }

        function check_bm_subtree(bm) {
            check_bm(bm);
            if (bm.children) {
                for (let i = 0; i < bm.children.length; ++i) {
                    const c = bm.children[i];
                    expect(c.parent, `${c.id}'s parent to be ${bm.id}`)
                        .to.equal(bm);
                    expect(c.index, `${c.id} to have index ${i}`).to.equal(i);
                    check_bm_subtree(c);
                }
            }
        }

        function check_tab(t) {
            expect(t.id, `${t.title} has an ID`).to.be.a('number');
            expect(t.isTab, `${t.id} is a tab`).to.equal(true);
            expect(t.title, `${t.id} has a title`).to.be.a('string');
            expect(t.url, `${t.id} has a URL`).to.be.a('string');
            expect(t.favIconUrl, `${t.id} has a favicon URL`)
                .to.be.a('string');
            expect(t.hidden, `${t.id} has a hidden property`)
                .to.be.a('boolean');
            expect(t.active, `${t.id} has an active property`)
                .to.be.a('boolean');
            expect(t.pinned, `${t.id} has a pinned property`)
                .to.be.a('boolean');

            const dbt = model.tabs_by_id(r.id);
            expect(r, `${r.id} to be indexed in tabs_by_id`).to.equal(dbt);

            const p = t.parent;
            expect(t.parent).to.not.be.undefined;
            expect(p.children[t.index], `${t.id} to be at index ${t.index} in parent ${p.id}`).to.equal(t);

            check_related(t);
        }

        function check_win(w) {
            expect(w.id, `${w} has an ID`).to.be.a('number');
            expect(w.isWindow, `${w.id} is a window`).to.equal(true);
            expect(w.focused, `${w.id} has a focused property`)
                .to.be.a('boolean');
            expect(w.type, `${w.id} has a type property`).to.be.a('string');

            const dbw = model.wins_by_id.get(w.id);
            expect(w, `${w.id} to be indexed in wins_by_id`).to.equal(dbw);

            for (let i = 0; i < w.children.length; ++i) {
                const c = w.children[i];
                expect(c.parent, `${c.id} has ${w.id} as its parent`)
                    .to.equal(w);
                expect(c.index, `${c.id} is at index ${i}`).to.equal(i);
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

    function simple_state() {
        return new M.StashState({
            id: 'root',
            type: 'folder',
            title: 'Root',
            dateAdded: 0,
            children: []
        }, [
            {id: 1, focused: true, type: 'normal',
             children: [
                 {id: 1, title: 'Foo', url: 'url://1',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: true, pinned: false},
             ]},
        ]);
    }

    function fancy_state() {
        return new M.StashState({
            id: 'root', type: 'folder', title: 'Root', dateAdded: 0,
            children: [
                {id: 'a', type: 'folder', title: 'Folder A', dateAdded: 0,
                 children: [
                     {id: '1', type: 'bookmark', dateAdded: 0,
                      title: 'Bookmark 1', url: 'url://1'},
                     {id: '2', type: 'bookmark', dateAdded: 0,
                      title: 'Bookmark 2', url: 'url://2'},
                 ]},
                {id: 'b', type: 'bookmark', dateAdded: 0,
                 title: 'Bookmark B', url: 'url://b'},
                {id: 'c', type: 'folder', title: 'Empty Folder C', dateAdded: 0,
                 children: []},
                {id: 'd', type: 'folder', title: 'Folder D', dateAdded: 0,
                 children: [
                     {id: 'd1', type: 'folder', title: 'Folder D1',
                      dateAdded: 0, children: []},
                     {id: 'd2', type: 'folder', title: 'Folder D2',
                      dateAdded: 0,
                      children: [
                          {id: 'd2a', type: 'bookmark', dateAdded: 0,
                           title: 'D2A', url: 'url://d2a'},
                          {id: 'd2b', type: 'bookmark', dateAdded: 0,
                           title: 'D2B', url: 'url://d2b'},
                          {id: 'd2c', type: 'bookmark', dateAdded: 0,
                           title: 'D2C', url: 'url://d2c'},
                          {id: 'd2d', type: 'bookmark', dateAdded: 0,
                           title: 'D2D', url: 'url://d2d'},
                          {id: 'dup1', type: 'bookmark', dateAdded: 0,
                           title: 'Dup1', url: 'url://dup1'},
                      ]},
                 ]},
                {id: 'dup1-1', type: 'bookmark', dateAdded: 0,
                 title: 'Dup 1 (1)', url: 'url://dup1'},
            ],
        }, [
            {id: 1, focused: true, type: 'normal',
             children: [
                 {id: 1, title: 'Foo', url: 'url://1',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: true, pinned: false},
                 {id: 2, title: 'Bar', url: 'url://bar-tab',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: false, pinned: false},
                 {id: 3, title: 'Fred', url: 'url://fred-tab',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: false, pinned: false},
             ]},
            {id: 2, focused: false, type: 'normal',
             children: [
                 {id: 3, title: 'Foo', url: 'url://1',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: true, pinned: true},
                 {id: 4, title: 'Bar', url: 'url://bar-tab',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: false, pinned: false},
                 {id: 5, title: 'Fred', url: 'url://fred-tab',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: false, pinned: false},
                 {id: 6, title: 'Hidden', url: 'url://2',
                  favIconUrl: 'favicon://foo',
                  hidden: true, active: false, pinned: false},
             ]},
        ]);
    }

    describe('construction', function() {
        it('can be constructed with a pre-existing state', function() {
            let model = fancy_state();
            check(model);
        });
    });

    describe('bookmarks', function() {
        let model;
        beforeEach(function() {
            model = simple_state();
        });

        it('creates/updates bookmarks', function() {
            for (let _ of [0, 1, 2]) {
                model.bm_updated('new', {
                    id: 'new', parentId: 'root', index: 0, dateAdded: 1,
                    title: 'New Title', url: 'url://new'});
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

        it('creates/updates subtrees of bookmarks', function() {
            for (let _ of [0, 1, 2]) {
                model.bm_updated('parent', {
                    id: 'parent', parentId: 'root', index: 0, dateAdded: 1,
                    title: 'Parent Folder', children: [
                        {id: 'child1', title: 'Child 1', dateAdded: 2,
                         url: 'url-child1'},
                        {id: 'child2', title: 'Child 2', dateAdded: 2,
                         url: 'url-child2'},
                        {id: 'new', title: 'New Title', dateAdded: 2,
                         url: 'url://new'},
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

        it('moves bookmarks within a folder', function() {
            model.bm_updated('parent', {
                id: 'parent', parentId: 'root', index: 0, dateAdded: 1,
                title: 'Parent Folder', children: [
                    {id: 'child1', title: 'Child 1', dateAdded: 2,
                     url: 'url-child1'},
                    {id: 'child2', title: 'Child 2', dateAdded: 2,
                     url: 'url-child2'},
                    {id: 'new', title: 'New Title', dateAdded: 2,
                     url: 'url://new'},
                ]});
            check(model);
            expect(model.bms_by_id.get('new')).to.include({
                isBookmark: true, id: 'new', title: 'New Title',
                parent: model.bms_by_id.get('parent'), index: 2,
            });

            for (let _ of [0, 1, 2]) {
                model.bm_updated('new', {index: 1});
                check(model);
                expect(model.bms_by_id.get('new')).to.include({
                    isBookmark: true, id: 'new', title: 'New Title',
                    parent: model.bms_by_id.get('parent'), index: 1,
                });
            }
        });

        it('moves bookmarks to a new folder', function() {
            model.bm_updated('parent', {
                id: 'parent', parentId: 'root', index: 0, dateAdded: 1,
                title: 'Parent Folder', children: [
                    {id: 'child1', title: 'Child 1', dateAdded: 2,
                     url: 'url-child1'},
                    {id: 'child2', title: 'Child 2', dateAdded: 2,
                     url: 'url-child2'},
                    {id: 'new', title: 'New Title', dateAdded: 2,
                     url: 'url://new'},
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
                model.bm_updated('new', {parentId: 'root', index: 1});
                check(model);
                expect(model.bms_by_id.get('new')).to.include({
                    isBookmark: true, id: 'new', title: 'New Title',
                    parent: model.bms_by_id.get('root'), index: 1,
                });
            }
        });

        it('updates bookmark titles/URLs', function() {
            model.bm_updated('new', {
                parentId: 'root', index: 0, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            check(model);
            expect(model.bms_by_id.get('new')).to.include({
                id: 'new', isBookmark: true, title: 'Foo', url: 'foo',
                parent: model.bms_by_id.get('root'), index: 0,
            });

            for (let _ of [0, 1, 2]) {
                model.bm_updated('new', {title: 'Bar', url: 'bar'});
                check(model);
                expect(model.bms_by_id.get('new')).to.include({
                    id: 'new', isBookmark: true, title: 'Bar', url: 'bar',
                    parent: model.bms_by_id.get('root'), index: 0,
                });
            }
        });

        it('removes bookmarks');
        it('removes folders and their children');
    });

    describe('windows and tabs', function() {
        it('creates windows with pre-populated tabs');
        it('removes windows and their associated tabs');
        it('creates tabs and inserts them into windows appropriately');
        it('removes tabs from their parent windows');
        it('moves tabs within a window');
        it('moves tabs between windows');
        it('replaces tabs with new IDs');
        it('updates tab titles/URLs');
    });

    describe('related bookmarks', function() {
        it('links duplicate bookmarks together');
        it('unlinks a duplicate bookmark when it is deleted');
        it('moves a bookmark from one URL set to another when its URL changes');
        it('unlinks a duplicate bookmark when its URL changes');
        it('links a newly-duplicated bookmark when its URL changes');
    });

    describe('related bookmarks and tabs', function() {
        it('links duplicate tabs together');
        it('links bookmarks with tabs with the same URLs');
        it('unlinks bookmarks/tabs when a linked tab is closed');
        it('unlinks bookmarks/tabs when the tab changes URLs');
    });
});
