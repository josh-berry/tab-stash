// The main export of this module is the StashState class, below.
//
// This rather complicated class maintains state which represents the current
// bookmarks tree and set of open tabs across all windows.  We maintain this
// data structure in a form that matches what the Vue views expect, so they can
// easily present info to the user, AND we can incrementally update the
// structure based on incoming browser events, and have it reflected in the UI.
//
// The alternative "functional" approach--regenerate the structure on every
// event, is too slow such that there is a noticeable lag.  So we use the
// stateful approach here, which is significantly faster, if also more
// complicated.
//
// The "outputs" (updated incrementally as events are delivered) are:
//
// - /this.bookmarks/ - A mirror of the browser's bookmark tree (as in
//   clone_bm()) representing all bookmarks starting with the browser root.
//
// - /this.bms_by_id/ - A Map of bookmarks, indexed by their browser IDs.
//
// - /this.wins_by_id/ - A Map of windows, indexed by their browser IDs.
//
// - /this.tabs_by_id/ - A Map of tabs, indexed by their browser IDs.
//
// - /this.items_by_url/ - A Map of arrays of bookmarks/tabs, indexed by URL.
//   (it's an array and not a Set because that's what Vue can deal with)
//
// YOU SHOULD NOT MODIFY ANY OF THE OUTPUTS EXCEPT THRU StashState METHODS.



// These are constructor-ish functions which return un-prototyped objects
// representing tabs and bookmarks.  They are created and mutated internally by
// StashState methods, but are exposed externally thru StashState member
// variables as described above.
//
// For uniformity, we use /parentId/, /index/ and /children/ for representing
// parent/child relationships between both tabs and bookmarks.  This allows us
// to use the same algorithms for repositioning/re-indexing children for both.
//
// NOTE: We make fresh new deep-copied objects for Vue because it likes to
// modify objects in-place, and then browser APIs start returning those
// modified Vue objects sometimes, which makes me really nervous...
function clone_win(w) {
    return {
        isWindow: true,
        id: w.id,

        focused: w.focused,
        type: w.type,

        // Relationships to other objects, filled in later:
        children: [], // Tabs in this window, as in clone_tab()
    };
}

function clone_tab(t) {
    return {
        isTab: true,
        id: t.id,

        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl,
        hidden: t.hidden,
        active: t.active,
        pinned: t.pinned,

        // Relationships to other objects, filled in later:
        parent: undefined,
        index: undefined,

        related: undefined, // [items with the same URL, including this item]
    };
}

function clone_bm(bm) {
    return {
        isBookmark: true,
        id: bm.id,

        title: bm.title,
        url: bm.url,
        dateAdded: bm.dateAdded,

        // Relationships to other objects, filled in later:
        parent: undefined,
        index: undefined,
        children: bm.type === 'folder' ? [/* clone_bm()s */] : undefined,
        related: undefined, // [items with the same URL, including this item]
    };
}



// Check if this item is somewhere in the folder identified by /folder_id/.  The
// /item/ should be an object returned by clone_bm() and managed by StashState.
export function isInFolder(folder_id, item) {
    while (item) {
        if (! item.isBookmark) return false;
        if (item.id === folder_id) return true;
        item = item.parent;
    }
    return false;
}



// See module documentation
export class StashState {
    static async make() {
        let defer_queue = [];

        // We register event handlers immediately, so that we are collecting
        // events even as we are waiting for the entire tree to get built.  We
        // need to do this to avoid missing events that come in while we are
        // building the tree--the end result will be a tree that's out of date.
        const maybe_defer = (fn) => {
            return (...args) => {
                if (defer_queue) {
                    defer_queue.push([fn, args]);
                } else {
                    fn(...args);
                }
            };
        };

        browser.bookmarks.onCreated.addListener(maybe_defer((id, bm) => {
            state._update_bm(bm);
        }));
        browser.bookmarks.onChanged.addListener(maybe_defer((id, info) => {
            // info: {title, url}
            //
            // NOTE: We use Object.assign here so that if title/url are missing,
            // they are not included in the info object directly.
            state._update_bm(Object.assign({id}, info));
        }));
        browser.bookmarks.onMoved.addListener(maybe_defer((id, info) => {
            // info: {parentId, index, oldParentId, oldIndex}
            state._update_bm({id, parentId: info.parentId, index: info.index});
        }));
        browser.bookmarks.onRemoved.addListener(maybe_defer((id, info) => {
            // info: {parentId, index, node [sans children]}
            state._drop_bm(id);
        }));

        browser.windows.onCreated.addListener(maybe_defer(win => {
            state._update_win(win);
        }));
        browser.windows.onRemoved.addListener(maybe_defer(winid => {
            state._drop_win(winid);
        }));

        browser.tabs.onCreated.addListener(maybe_defer(tab => {
            state._update_tab(tab);
        }));
        browser.tabs.onAttached.addListener(maybe_defer((id, info) => {
            // info: {newWindowId, newPosition}
            //
            // NOTE: We do this weird assignment thing because _update_tab
            // expects properties we don't know anything about to not
            // exist--letting them exist and setting them to 'undefined' is the
            // same as explicitly unsetting them.
            let o = {id};
            if (info.newWindowId !== undefined) o.windowId = info.newWindowId;
            if (info.newPosition !== undefined) o.index = info.newPosition;
            state._update_tab(o);
        }));
        browser.tabs.onMoved.addListener(maybe_defer((id, info) => {
            // info: {windowId, fromIndex, toIndex}
            //
            // NOTE: We do this weird assignment thing because _update_tab
            // expects properties we don't know anything about to not
            // exist--letting them exist and setting them to 'undefined' is the
            // same as explicitly unsetting them.
            let o = {id};
            if (info.windowId !== undefined) o.windowId = info.windowId;
            if (info.toIndex !== undefined) o.index = info.toIndex;
            state._update_tab(o);
        }));
        browser.tabs.onRemoved.addListener(maybe_defer((id, info) => {
            // info: {windowId, isWindowClosing}
            state._drop_tab(id);
        }));
        browser.tabs.onReplaced.addListener(maybe_defer((new_id, old_id) => {
            state._replace_tab(new_id, old_id);
        }));
        browser.tabs.onUpdated.addListener(maybe_defer((id, info, tab) => {
            // info: {audible, discarded, favIconUrl, hidden, isArticle,
            //        mutedInfo, pinned, status, title, url}
            // all optional, all representing the updated state.
            // /tab/ is the Tab object with the updated state.
            state._update_tab(tab);
        }));

        let state = new StashState(
            (await browser.bookmarks.getSubTree(""))[0],
            await browser.windows.getAll(
                {populate: true, windowTypes: ['normal']}));

        // Once we have finished buildin the state object, bring it up-to-date
        // with any events that were delivered while we were querying the
        // browser.
        for (let [fn, args] of defer_queue) fn(...args);
        defer_queue = undefined;

        return state;
    }

    // Don't call this.  Call make() instead.
    constructor(bookmarks_root, windows) {
        this.bms_by_id = new Map();
        this.wins_by_id = new Map();
        this.tabs_by_id = new Map();
        this.items_by_url = new Map();

        this.bookmarks = this._index_new_bm(bookmarks_root);

        // Populates wins_by_id
        for (let win of windows) this._index_new_win(win);
    }

    _index_new_bm(bm) {
        let i = clone_bm(bm);
        this.bms_by_id.set(bm.id, i);
        this._update_url(i, i.url);
        if (bm.children) {
            i.children = bm.children.map(c => this._index_new_bm(c));
        }
        this._reposition(i, bm.parentId, bm.index);
        return i;
    }

    _update_bm(bm) {
        let i = this.bms_by_id.get(bm.id);
        if (! i) {
            this._index_new_bm(bm);
            return;
        }

        if (bm.hasOwnProperty('title')) i.title = bm.title;
        if (bm.hasOwnProperty('url')) this._update_url(i, bm.url);
        if (bm.hasOwnProperty('dateAdded')) i.dateAdded = bm.dateAdded;

        if (bm.hasOwnProperty('parentId') || bm.hasOwnProperty('index')) {
            this._reposition(i, bm.parentId, bm.index);
        }
    }

    _drop_bm(bmid) {
        let i = this.bms_by_id.get(bmid);
        if (! i) return;

        // First drop all our child bookmarks, if we have any.
        if (i.children) {
            let children = i.children;
            i.children = [];
            for (let c of children) this._drop_bm(c.id);
        }

        // And finally, remove ourselves from the database.
        this._reposition(i, undefined, undefined);
        this._update_url(i, undefined);
        this.bms_by_id.delete(bmid);
    }

    _index_new_win(win) {
        let i = clone_win(win);
        this.wins_by_id.set(win.id, i);
        if (win.tabs) i.children = win.tabs.map(t => this._index_new_tab(t));
        return i;
    }

    _update_win(win) {
        let i = this.wins_by_id.get(win.id);
        if (! i) {
            this._index_new_win(win);
            return;
        }

        if (win.hasOwnProperty('focused')) i.focused = win.focused;
        // Don't care about the other win properties
    }

    _drop_win(winid) {
        let i = this.wins_by_id.get(winid);
        if (! i) return;

        let tabs = i.tabs;
        i.tabs = [];
        for (let t of tabs) this._drop_tab(t.id);
        this.wins_by_id.delete(winid);
    }

    _index_new_tab(tab) {
        let i = clone_tab(tab);
        this.tabs_by_id.set(i.id, i);
        this._update_url(i, i.url);
        this._reposition(i, tab.windowId, tab.index);
        return i;
    }

    _update_tab(tab) {
        let i = this.tabs_by_id.get(tab.id);
        if (! i) {
            this._index_new_tab(tab);
            return;
        }

        if (tab.hasOwnProperty('title')) i.title = tab.title;
        if (tab.hasOwnProperty('url')) this._update_url(i, tab.url);
        if (tab.hasOwnProperty('favIconUrl')) i.favIconUrl = tab.favIconUrl;
        if (tab.hasOwnProperty('hidden')) i.hidden = tab.hidden;
        if (tab.hasOwnProperty('active')) i.active = tab.active;
        if (tab.hasOwnProperty('pinned')) i.pinned = tab.pinned;

        if (tab.hasOwnProperty('windowId') || tab.hasOwnProperty('index')) {
            this._reposition(i, tab.windowId, tab.index);
        }
    }

    _replace_tab(newid, oldid) {
        let i = this.tabs_by_id.get(oldid);
        if (! i) return;
        this.tabs_by_id.delete(oldid);
        this.tabs_by_id.set(newid, i);
        i.id = newid;
    }

    _drop_tab(tabid) {
        let i = this.tabs_by_id.get(tabid);
        if (! i) return;

        this._reposition(i, undefined, undefined);
        this._update_url(i, undefined);
        this.tabs_by_id.delete(tabid);
    }

    _reposition(item, newParentId, newIndex) {
        // NOTE: We expect to see new parents before we see any of their
        // children.  Children will not get linked properly into parents that
        // don't exist yet.

        // Find the new parent (even if it's the same as the old, or no parent)
        let new_parent = undefined;
        if (newIndex >= 0) {
            if (newParentId === undefined
                || (item.parent && newParentId === item.parent.id))
            {
                // If the new parent and new index are the same as the old ones,
                // don't waste cycles on what will be a no-op.
                if (newIndex === item.index) return;

                // Same parent (possibly no parent), different index (which is
                // ignored if we have no parent, since the root bookmark always
                // shows up at index 0).
                new_parent = item.parent;

            } else {
                // Different (or new) parent.
                let parent_idx = item.isTab ? this.wins_by_id : this.bms_by_id;
                new_parent = parent_idx.get(newParentId);
                if (! new_parent) throw {item, newParentId, newIndex};
            }

        } else {
            console.assert(newParentId === undefined,
                           "Must specify an index when specifying a parent");
        }

        // First remove from the old parent
        if (item.parent) {
            let idx = item.parent.children.indexOf(item);
            if (idx >= 0) {
                item.parent.children.splice(idx, 1);
                for (let i = idx; i < item.parent.children.length; ++i) {
                    item.parent.children[i].index = i;
                }
            }
            item.parent = undefined;
            item.index = undefined;
        }

        // Then add to the new
        if (new_parent) {
            new_parent.children.splice(newIndex, 0, item);
            for (let i = newIndex + 1; i < new_parent.children.length; ++i) {
                new_parent.children[i].index = i;
            }

            item.parent = new_parent;
            item.index = newIndex;
        }
    }

    _update_url(i, url) {
        if (i.related) {
            let idx = i.related.indexOf(i);
            console.assert(idx >= 0);
            i.related.splice(idx, 1);
            if (i.related.length <= 0) this.items_by_url.delete(i.url);

            i.url = undefined;
            i.related = undefined;
        }

        if (url) {
            let related = this.items_by_url.get(url);
            if (! related) {
                related = [];
                this.items_by_url.set(url, related);
            }
            related.push(i);

            i.url = url;
            i.related = related;
        }
    }
}
