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
                    const dbt = model.tabs_by_id.get(r.id);
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
                    if (c === undefined) continue;
                    expect(c.parent, `${c.id}'s parent to be ${bm.id}`)
                        .to.equal(bm);
                    expect(c.index, `${c.id} to have index ${i}`).to.equal(i);
                    check_bm_subtree(c);
                }
            }
        }

        function check_tab(t) {
            expect(t.id, `tab ${t.title} has an ID`).to.be.a('number');
            expect(t.isTab, `tab ${t.id} is a tab`).to.equal(true);
            expect(t.title, `tab ${t.id} has a title`).to.be.a('string');
            expect(t.url, `tab ${t.id} has a URL`).to.be.a('string');
            expect(t.favIconUrl, `tab ${t.id} has a favicon URL`)
                .to.be.a('string');
            expect(t.hidden, `tab ${t.id} has a hidden property`)
                .to.be.a('boolean');
            expect(t.active, `tab ${t.id} has an active property`)
                .to.be.a('boolean');
            expect(t.pinned, `tab ${t.id} has a pinned property`)
                .to.be.a('boolean');

            const dbt = model.tabs_by_id.get(t.id);
            expect(t, `tab ${t.id} to be indexed in tabs_by_id`).to.equal(dbt);

            const p = t.parent;
            expect(t.parent).to.not.be.undefined;
            expect(p.children[t.index],
                   `tab ${t.id} to be at index ${t.index} in win ${p.id}`)
                .to.equal(t);

            check_related(t);
        }

        function check_win(w) {
            expect(w.id, `win ${w.title} has an ID`).to.be.a('number');
            expect(w.isWindow, `win ${w.id} is a window`).to.equal(true);
            expect(w.focused, `win ${w.id} has a focused property`)
                .to.be.a('boolean');
            expect(w.type, `win ${w.id} has a type property`).to.be.a('string');

            const dbw = model.wins_by_id.get(w.id);
            expect(w, `win ${w.id} to be indexed in wins_by_id`).to.equal(dbw);

            for (let i = 0; i < w.children.length; ++i) {
                const c = w.children[i];
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

    function simple_state() {
        return new M.StashState({
            id: 'root',
            type: 'folder',
            title: 'Root',
            dateAdded: 0,
            children: []
        }, [
            {id: 1, focused: true, type: 'normal',
             tabs: [
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
                          undefined,
                          {id: 'd2e', type: 'bookmark', dateAdded: 0,
                           title: 'D2E', url: 'url://d2e'},
                      ]},
                 ]},
                {id: 'dup1-1', type: 'bookmark', dateAdded: 0,
                 title: 'Dup 1 (1)', url: 'url://dup1'},
            ],
        }, [
            {id: 1, focused: true, type: 'normal',
             tabs: [
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
             tabs: [
                 {id: 4, title: 'Foo', url: 'url://1',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: true, pinned: true},
                 {id: 5, title: 'Bar', url: 'url://bar-tab',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: false, pinned: false},
                 {id: 6, title: 'Fred', url: 'url://fred-tab',
                  favIconUrl: 'favicon://foo',
                  hidden: false, active: false, pinned: false},
                 {id: 7, title: 'Hidden', url: 'url://2',
                  favIconUrl: 'favicon://foo',
                  hidden: true, active: false, pinned: false},
                 undefined,
                 {id: 9, title: 'Sparse', url: 'url://sparse',
                  favIconUrl: 'favicon://sparse',
                  hidden: false, active: false, pinned: false},
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
            expect(model.bookmarks).to.equal(model.bms_by_id.get('root'));
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

        it('shifts indexes right when inserting new children', function() {
            model.bm_updated('new', {
                parentId: 'root', index: 0, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            check(model);
            expect(model.bms_by_id.get('new').index).to.equal(0);
            model.bm_updated('new2', {
                parentId: 'root', index: 1, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            expect(model.bms_by_id.get('new').index).to.equal(0);
            expect(model.bms_by_id.get('new2').index).to.equal(1);
            check(model);
            model.bm_updated('new3', {
                parentId: 'root', index: 0, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            expect(model.bms_by_id.get('new').index).to.equal(1);
            expect(model.bms_by_id.get('new2').index).to.equal(2);
            expect(model.bms_by_id.get('new3').index).to.equal(0);
            check(model);
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

        it('removes bookmarks', function() {
            model.bm_updated('new', {
                parentId: 'root', index: 0, title: 'Foo', url: 'foo',
                dateAdded: 1
            });
            check(model);
            expect(model.bms_by_id.get('new')).to.include({
                id: 'new', isBookmark: true, title: 'Foo', url: 'foo',
                parent: model.bms_by_id.get('root'), index: 0,
            });
            expect(model.items_by_url.get('foo'))
                .to.eql([model.bms_by_id.get('new')]);
            model.bm_removed('new');
            expect(model.bms_by_id.get('new')).to.equal(undefined);
            expect(model.bookmarks.children.length).to.equal(0);
            expect(model.items_by_url.get('foo')).to.equal(undefined);
            check(model);
        });

        it('removes folders and their children', function() {
            model.bm_updated('new', {
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
            model.bm_removed('new');
            expect(model.bms_by_id.get('new')).to.equal(undefined);
            expect(model.bms_by_id.get('child1')).to.equal(undefined);
            expect(model.bms_by_id.get('child2')).to.equal(undefined);
            expect(model.bms_by_id.get('child3')).to.equal(undefined);
            expect(model.bms_by_id.get('f1')).to.equal(undefined);
            expect(model.bookmarks.children.length).to.equal(0);
            check(model);
        });

        it('shifts indexes left when removing children', function() {
            model.bm_updated('new', {
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
            expect(model.bms_by_id.get('child1').index).to.equal(0);
            expect(model.bms_by_id.get('child2').index).to.equal(1);
            expect(model.bms_by_id.get('child3').index).to.equal(2);
            expect(model.bms_by_id.get('child4').index).to.equal(3);
            check(model);

            model.bm_removed('child1');
            expect(model.bms_by_id.get('child1')).to.equal(undefined);
            expect(model.bms_by_id.get('child2').index).to.equal(0);
            expect(model.bms_by_id.get('child3').index).to.equal(1);
            expect(model.bms_by_id.get('child4').index).to.equal(2);
            check(model);

            model.bm_removed('child3');
            expect(model.bms_by_id.get('child1')).to.equal(undefined);
            expect(model.bms_by_id.get('child2').index).to.equal(0);
            expect(model.bms_by_id.get('child3')).to.equal(undefined);
            expect(model.bms_by_id.get('child4').index).to.equal(1);
            check(model);
        });
    });

    describe('windows and tabs', function() {
        let model;
        beforeEach(function() {
            model = simple_state();
            expect(model.bookmarks).to.equal(model.bms_by_id.get('root'));
        });

        it('creates windows with pre-populated tabs', function() {
            model.win_created({
                id: 2, focused: true, type: 'normal', tabs: [
                    {id: 2, title: 'Tab 1', url: 'url1', favIconUrl: 'fav1',
                     hidden: false, active: false, pinned: false},
                    {id: 3, title: 'Tab 2', url: 'url2', favIconUrl: 'fav2',
                     hidden: false, active: false, pinned: false},
                ]});
            expect(model.wins_by_id.get(2)).to.deep.include({
                isWindow: true,
                id: 2, focused: true, type: 'normal', children: [
                    model.tabs_by_id.get(2),
                    model.tabs_by_id.get(3),
                ]});
            expect(model.tabs_by_id.get(2)).to.include({
                id: 2, title: 'Tab 1', url: 'url1', favIconUrl: 'fav1',
                hidden: false, active: false, pinned: false, isTab: true,
                parent: model.wins_by_id.get(2), index: 0,
            });
            expect(model.tabs_by_id.get(3)).to.include({
                id: 3, title: 'Tab 2', url: 'url2', favIconUrl: 'fav2',
                hidden: false, active: false, pinned: false, isTab: true,
                parent: model.wins_by_id.get(2), index: 1,
            });
            expect(model.tabs_by_id.get(2).parent)
                .to.equal(model.wins_by_id.get(2));
            expect(model.tabs_by_id.get(3).parent)
                .to.equal(model.wins_by_id.get(2));
            check(model);
        });

        it('removes windows and their associated tabs', function() {
            expect(model.wins_by_id.get(1)).to.include({id: 1});
            expect(model.tabs_by_id.get(1)).to.include({id: 1});
            model.win_removed(1);
            expect(model.tabs_by_id.get(1)).to.equal(undefined);
            expect(model.wins_by_id.get(1)).to.equal(undefined);
            check(model);
        });

        it('creates tabs and inserts them into windows in the right place',
           function() {
               expect(model.wins_by_id.get(1)).to.include({id: 1});
               expect(model.tabs_by_id.get(1)).to.include({id: 1, index: 0});

               model.tab_created({
                   id: 2, windowId: 1, index: 1, title: 'New Tab',
                   url: 'newtab', favIconUrl: 'favicon', hidden: false,
                   active: true, pinned: false
               });
               expect(model.tabs_by_id.get(2)).to.include({
                   id: 2, parent: model.wins_by_id.get(1), index: 1,
                   title: 'New Tab',
                   url: 'newtab', favIconUrl: 'favicon', hidden: false,
                   active: true, pinned: false
               });
               expect(model.wins_by_id.get(1)).to.deep.include({
                   children: [
                       model.tabs_by_id.get(1),
                       model.tabs_by_id.get(2),
                   ]});
               check(model);

               model.tab_created({
                   id: 3, windowId: 1, index: 0, title: 'First Tab',
                   url: 'first', favIconUrl: 'first', hidden: false,
                   active: false, pinned: false,
               });
               expect(model.tabs_by_id.get(3)).to.include({
                   id: 3, parent: model.wins_by_id.get(1), index: 0,
                   title: 'First Tab',
                   url: 'first', favIconUrl: 'first', hidden: false,
                   active: false, pinned: false,
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

            model.tab_created({
                id: 2, windowId: 1, index: 1, title: 'New Tab',
                url: 'newtab', favIconUrl: 'favicon', hidden: false,
                active: true, pinned: false
            });
            model.tab_created({
                id: 3, windowId: 1, index: 2, title: 'New Tab #2',
                url: 'newtab2', favIconUrl: 'favicon', hidden: false,
                active: true, pinned: false
            });
            model.tab_created({
                id: 4, windowId: 1, index: 3, title: 'New Tab #3',
                url: 'newtab3', favIconUrl: 'favicon', hidden: false,
                active: true, pinned: false
            });
            check(model);
        }

        it('removes tabs from their parent windows', function() {
            move_remove_tab_state();

            model.tab_removed(4);
            expect(model.wins_by_id.get(1).children).to.deep.equal([
                model.tabs_by_id.get(1),
                model.tabs_by_id.get(2),
                model.tabs_by_id.get(3),
            ]);
            check(model);

            model.tab_removed(2);
            expect(model.wins_by_id.get(1).children).to.deep.equal([
                model.tabs_by_id.get(1),
                model.tabs_by_id.get(3),
            ]);
            check(model);

            model.tab_removed(1);
            expect(model.wins_by_id.get(1).children).to.deep.equal([
                model.tabs_by_id.get(3),
            ]);
            check(model);
        });

        it('moves tabs within a window', function() {
            move_remove_tab_state();

            model.tab_moved(4, {windowId: 1, toIndex: 0});
            expect(model.tabs_by_id.get(4).index).to.equal(0);
            expect(model.tabs_by_id.get(1).index).to.equal(1);
            expect(model.tabs_by_id.get(2).index).to.equal(2);
            expect(model.tabs_by_id.get(3).index).to.equal(3);
            check(model);

            model.tab_moved(4, {windowId: 1, toIndex: 3});
            expect(model.tabs_by_id.get(1).index).to.equal(0);
            expect(model.tabs_by_id.get(2).index).to.equal(1);
            expect(model.tabs_by_id.get(3).index).to.equal(2);
            expect(model.tabs_by_id.get(4).index).to.equal(3);
            check(model);

            model.tab_moved(3, {windowId: 1, toIndex: 1});
            expect(model.tabs_by_id.get(1).index).to.equal(0);
            expect(model.tabs_by_id.get(3).index).to.equal(1);
            expect(model.tabs_by_id.get(2).index).to.equal(2);
            expect(model.tabs_by_id.get(4).index).to.equal(3);
            check(model);
        });

        it('moves tabs between windows', function() {
            move_remove_tab_state();
            model.win_created({
                id: 2, focused: false, type: 'normal',
                tabs: [
                    {id: 5, title: 'Mambo #5', url: 'mambo',
                     favIconUrl: 'mambo',
                     hidden: false, active: false, pinned: false},
                    {id: 6, title: 'words long', url: 'words',
                     favIconUrl: 'words',
                     hidden: false, active: false, pinned: false},
                ],
            });
            check(model);

            model.tab_moved(4, {windowId: 2, toIndex: 2});
            expect(model.tabs_by_id.get(1).index).to.equal(0);
            expect(model.tabs_by_id.get(2).index).to.equal(1);
            expect(model.tabs_by_id.get(3).index).to.equal(2);
            expect(model.tabs_by_id.get(5).index).to.equal(0);
            expect(model.tabs_by_id.get(6).index).to.equal(1);
            expect(model.tabs_by_id.get(4).parent).to.equal(
                model.wins_by_id.get(2));
            expect(model.tabs_by_id.get(4).index).to.equal(2);
            check(model);

            model.tab_moved(6, {windowId: 1, toIndex: 0});
            expect(model.tabs_by_id.get(6).parent).to.equal(
                model.wins_by_id.get(1));
            expect(model.tabs_by_id.get(6).index).to.equal(0);
            expect(model.tabs_by_id.get(1).index).to.equal(1);
            expect(model.tabs_by_id.get(2).index).to.equal(2);
            expect(model.tabs_by_id.get(3).index).to.equal(3);
            expect(model.tabs_by_id.get(5).index).to.equal(0);
            expect(model.tabs_by_id.get(4).parent).to.equal(
                model.wins_by_id.get(2));
            expect(model.tabs_by_id.get(4).index).to.equal(1);
            check(model);
        });

        it('replaces tabs with new IDs', function() {
            expect(model.tabs_by_id.get(1).id).to.equal(1);

            model.tab_replaced(2, 1);
            expect(model.tabs_by_id.get(1)).to.equal(undefined);
            expect(model.tabs_by_id.get(2).id).to.equal(2);
            expect(model.tabs_by_id.get(2).url).to.equal('url://1');
            expect(model.wins_by_id.get(1)).to.deep.include({
                children: [
                    model.tabs_by_id.get(2),
                ],
            });
            check(model);
        });

        it('updates tab URLs', function() {
            expect(model.tabs_by_id.get(1).url).to.equal('url://1');
            expect(model.items_by_url.get('url://1')).to.contain(
                model.tabs_by_id.get(1));

            model.tab_updated({id: 1, url: 'bar://'});
            expect(model.tabs_by_id.get(1).url).to.equal('bar://');
            expect(model.items_by_url.get('url://1')).to.equal(undefined);
            expect(model.items_by_url.get('bar://')).to.contain(
                model.tabs_by_id.get(1));
            check(model);
        });

        it('updates tab titles', function() {
            expect(model.tabs_by_id.get(1).title).to.equal('Foo');
            model.tab_updated({id: 1, title: 'Bar'});
            expect(model.tabs_by_id.get(1).title).to.equal('Bar');
            check(model);
        });
    });

    describe('related bookmarks', function() {
        let model;
        beforeEach(function() {
            model = simple_state();
            model.bm_updated('1',
                             {id: '1', url: 'url://1', title: '1',
                              parentId: 'root', index: 0, dateAdded: 0});
            model.bm_updated('1prime',
                             {id: '1prime', url: 'url://1', title: '1-prime',
                              parentId: 'root', index: 1, dateAdded: 0});
            model.bm_updated('2',
                             {id: '2', url: 'url://2', title: '2',
                              parentId: 'root', index: 2, dateAdded: 0});
            expect(model.items_by_url.get('url://1')).to.include.members([
                model.bms_by_id.get('1'),
                model.bms_by_id.get('1prime'),
            ]);
        });

        it('links duplicate bookmarks together', function() {
            check(model);
        });

        it('unlinks a duplicate bookmark when it is deleted', function() {
            model.bm_removed('1prime');
            expect(model.items_by_url.get('url://1')).to.include.members([
                model.bms_by_id.get('1'),
            ]);
            check(model);
        });

        it('moves a bookmark from one URL set to another when its URL changes',
           function() {
               model.bm_updated('1prime', {id: '1prime', url: 'url://2'});
               expect(model.items_by_url.get('url://1')).to.include.members([
                   model.bms_by_id.get('1'),
               ]);
               expect(model.items_by_url.get('url://2')).to.include.members([
                   model.bms_by_id.get('2'),
                   model.bms_by_id.get('1prime'),
               ]);
               check(model);
           });
    });

    describe('related bookmarks and tabs', function() {
        let model;
        beforeEach(function() {
            model = fancy_state();
            check(model);
        });

        it('links duplicate tabs together', function() {
            expect(model.items_by_url.get('url://1')).to.include.members([
                model.bms_by_id.get('1'),
                model.tabs_by_id.get(1),
                model.tabs_by_id.get(4),
            ]);
        });

        it('links bookmarks with tabs with the same URLs', function() {
            expect(model.items_by_url.get('url://2')).to.include.members([
                model.bms_by_id.get('2'),
                model.tabs_by_id.get(7),
            ]);
        });

        it('unlinks a tab when it is closed', function() {
            model.tab_removed(3);
            expect(model.items_by_url.get('url://1')).to.include.members([
                model.bms_by_id.get('1'),
                model.tabs_by_id.get(1),
            ]);
            check(model);
        });

        it('moves a tab from one URL set to another when its URL changes',
           function() {
               model.tab_updated({id: 7, url: 'newtab'});
               expect(model.items_by_url.get('url://1')).to.include.members([
                   model.bms_by_id.get('1'),
                   model.tabs_by_id.get(1),
               ]);
               expect(model.items_by_url.get('newtab')).to.include.members([
                   model.tabs_by_id.get(7),
               ]);
               check(model);
        });
    });
});
