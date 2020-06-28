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
// - /this.bookmarks/ - A mirror of the browser's bookmark tree representing all
//   bookmarks starting with the browser root.
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
// YOU SHOULD NOT MODIFY ANY OF THE OUTPUTS EXCEPT THRU NON-`_` METHODS.

import {DeferQueue, OpenableURL, urlToOpen, namedPromises} from './util';

import {Cache, CacheEntry} from './cache-client';

// These model objects are designed to look like plain old objects for Vue's
// consumption.  They are created and mutated internally by StashState methods,
// but are exposed externally thru StashState member variables as described
// above.  You should not modify them yourself (even via the update() and
// remove() methods that are present on each object).
//
// For uniformity, we use /parentId/, /index/ and /children/ for representing
// parent/child relationships between both tabs and bookmarks.  This allows us
// to use the same algorithms for repositioning/re-indexing children for both.
//
// NOTE: There are a lot of optional properties that are explicitly initialized
// to be `undefined`.  This is intentional--without doing this, TypeScript will
// not create the properties on the objects at all and Vue won't know to watch
// them for changes.

export type FaviconCache = Cache<string>;
export type FaviconCacheEntry = CacheEntry<string>;

export interface ModelItem {
    readonly state: StashState;
    readonly id: number | string;
}

export interface ModelParent extends ModelItem {
    children?: (ModelLeaf | undefined)[];
}

export interface ModelLeaf extends ModelItem {
    isTab?: boolean;
    isBookmark?: boolean;

    title?: string;
    url?: string;
    favicon?: FaviconCacheEntry;

    parent?: ModelParent;
    index?: number;
    related?: ModelLeaf[];
}

export class Window implements ModelParent {
    readonly state: StashState;
    readonly id: number;
    readonly isWindow: boolean = true;

    focused: boolean = false;
    type: browser.windows.WindowType = 'normal';

    // Relationships to other objects, filled in later:
    children: (Tab | undefined)[] = [];

    //
    // PRIVATE IMPLEMENTATION PAST THIS POINT.
    //

    constructor(state: StashState, id: number) {
        this.state = state;
        this.id = id;
        if (state.wins_by_id.has(id)) throw state.wins_by_id.get(id);
        state.wins_by_id.set(id, this);
    }

    _update(w: Partial<browser.windows.Window>): Window {
        if (w.focused !== undefined) this.focused = w.focused;
        if (w.type !== undefined) this.type = w.type;

        if (w.tabs !== undefined) {
            for (const c of this.children) {
                if (! c) continue;
                c.parent = undefined;
                c.index = undefined;
            }
            this.children = w.tabs.map((t, i) => {
                if (t.id === undefined) {
                    // This is a devtools or special tab of some kind--ignore it
                    return undefined;
                }
                const r = this.state._tab(t.id)._update({
                    title: t.title,
                    url: t.url,
                    favIconUrl: t.favIconUrl,
                    hidden: t.hidden,
                    active: t.active,
                    pinned: t.pinned,
                    status: t.status || 'complete',
                });
                r.parent = this;
                r.index = i;
                return r;
            });
        }

        return this;
    }

    _remove() {
        this.state.wins_by_id.delete(this.id);
        for (let t of this.children) {
            if (! t) continue;
            t.parent = undefined;
            t.index = undefined;
            t._remove();
        }
        this.children = [];
    }
}

export class Tab implements ModelLeaf {
    readonly state: StashState;
    id: number; // not readonly because of _tab_replaced()
    readonly isTab: boolean = true;

    title?: string = undefined;
    url?: string = undefined;
    favicon?: FaviconCacheEntry = undefined;
    favIconUrl?: string = undefined;
    hidden: boolean = false;
    active: boolean = false;
    pinned: boolean = false;

    // Relationships to other objects, filled in later:
    parent?: Window = undefined;
    index?: number = undefined;
    related?: ModelItem[] = undefined;

    //
    // PRIVATE IMPLEMENTATION PAST THIS POINT.
    //

    constructor(state: StashState, id: number) {
        this.state = state;
        this.id = id;
        if (state.tabs_by_id.has(id)) throw state.tabs_by_id.get(id);
        state.tabs_by_id.set(id, this);
    }

    _update(t: Partial<browser.tabs.Tab>): Tab {
        if (t.title !== undefined) this.title = t.title;
        if (t.hidden !== undefined) this.hidden = t.hidden;
        if (t.active !== undefined) this.active = t.active;
        if (t.pinned !== undefined) this.pinned = t.pinned;

        if (t.windowId !== undefined || t.index !== undefined) {
            this.state._reposition(this, t.windowId, t.index);
        }

        if (t.url) {
            this.state._update_url(this, t.url);

            if (t.favIconUrl && t.status === 'complete') {
                this.favIconUrl = t.favIconUrl;
                this.favicon = undefined;
                try {
                    this.favicon = this.state.favicon_cache.set(
                        urlToOpen(t.url), t.favIconUrl);
                } catch (e) {}
            } else {
                // We ignore favicons when the tab is still loading, because
                // Firefox may send us events where a tab has a new URL, but an
                // old favicon which is for the URL the tab is navigating away
                // from.
                this.favIconUrl = undefined;
                this.favicon = undefined;
            }
        }

        return this;
    }

    _remove() {
        if (this.parent) this.state._reposition(this, undefined, undefined);
        if (this.url) this.state._update_url(this, undefined);
        this.state.tabs_by_id.delete(this.id);
    }
}

export class Bookmark implements ModelParent, ModelLeaf {
    readonly state: StashState;
    readonly id: string;
    readonly isBookmark: boolean = true;

    // Some invariants to keep in mind:
    //
    // This bookmark is a folder IFF children is an array (even if the array is
    // empty).  Otherwise, if children is undefined, this is a leaf node (an
    // actual bookmark).
    //
    // Note that the same may conceivably not hold true for the URL--the URL is
    // definitely undefined if this is a folder, but URL may or may not be
    // defined for an actual bookmark.  A leaf bookmark with an undefined URL
    // might be a separator, or we might just not know the URL yet.

    title?: string = undefined;
    url?: string = undefined;
    favicon?: FaviconCacheEntry = undefined;
    dateAdded?: number = undefined;

    parent?: Bookmark = undefined;
    index?: number = undefined;
    children?: (Bookmark | undefined)[] = undefined;
    related?: ModelLeaf[] = undefined;

    // Check if this item is somewhere in the folder identified by /folder_id/.
    isInFolder(folder_id: string) {
        let item: Bookmark | undefined = this;
        while (item) {
            if (item.id === folder_id) return true;
            item = item.parent;
        }
        return false;
    }

    //
    // PRIVATE IMPLEMENTATION PAST THIS POINT.
    //

    constructor(state: StashState, id: string) {
        this.state = state;
        this.id = id;
        if (state.bms_by_id.has(id)) throw state.bms_by_id.get(id);
        state.bms_by_id.set(id, this);
    }

    _update(bm: Partial<browser.bookmarks.BookmarkTreeNode>): Bookmark {
        if (bm.title !== undefined) this.title = bm.title;
        if (bm.url !== undefined) this.state._update_url(this, bm.url);
        if (bm.dateAdded !== undefined) this.dateAdded = bm.dateAdded;

        if (bm.parentId !== undefined || bm.index !== undefined) {
            this.state._reposition(this, bm.parentId, bm.index);
        }

        if (bm.children !== undefined) {
            if (this.children) {
                for (const c of this.children) {
                    if (! c) continue;
                    c.parent = undefined;
                    c.index = undefined;
                }
            }
            this.children = bm.children.map((c, i) => {
                const r = this.state._bookmark(c.id)._update({
                    title: c.title,
                    url: c.url,
                    dateAdded: c.dateAdded,
                    children: c.children,
                });
                r.parent = this;
                r.index = i;
                return r;
            });
        } else if (bm.type === 'folder' && this.children === undefined) {
            // SPECIAL CASE: If we know this item is a folder, but we don't know
            // what its children are yet, set children to an empty array.  This
            // is needed to support the invariant mentioned near the top of this
            // class, because otherwise there's no way to distinguish a folder
            // from a leaf node.
            this.children = [];
        }

        return this;
    }

    _remove() {
        if (this.parent) this.state._reposition(this, undefined, undefined);
        if (this.url) this.state._update_url(this, undefined);
        if (this.children) {
            const children = this.children;
            this.children = [];
            for (const c of children) {
                if (! c) continue;
                c.parent = undefined;
                c.index = undefined;
                c._remove();
            }
        }
        this.state.bms_by_id.delete(this.id);
    }
}



// See module documentation
export class StashState {
    favicon_cache: FaviconCache;

    bms_by_id: Map<string, Bookmark> = new Map();
    wins_by_id: Map<number, Window> = new Map();
    tabs_by_id: Map<number, Tab> = new Map();
    items_by_url: Map<OpenableURL, ModelLeaf[]> = new Map();

    bookmarks: Bookmark;

    static async make() {
        const evq = new DeferQueue();
        let state: StashState;

        //
        // Wire up browser events so that we update the state when the browser
        // tells us something has changed.  All the event handlers are wrapped
        // with DeferQueue.wrap() because we will start receiving events
        // immediately, even before the state has been constructed.
        //
        // This is by design--we record these events in the DeferQueue, and then
        // perform all the (asynchronous) browser queries needed to build the
        // state.  However, these queries will race with the events we receive,
        // and the result of the query might be out-of-date compared to what
        // info we get from events.  So we queue and delay processing of any
        // events until the state is fully constructed.
        //

        // Note: Can't do this the usual way with .bind() because the state
        // doesn't exist yet.
        const bmupdate = evq.wrap(
            (id: string, info: Partial<browser.bookmarks.BookmarkTreeNode>) => {
                // info could contain any of a number of things matching
                // BookmarkTreeNode, although we ignore/don't use any of the
                // old* args (and they aren't part of the function's type).
                state._bookmark(id)._update(info);
            });

        browser.bookmarks.onCreated.addListener(bmupdate);
        browser.bookmarks.onChanged.addListener(bmupdate);
        browser.bookmarks.onMoved.addListener(bmupdate);
        browser.bookmarks.onRemoved.addListener(
            evq.wrap(id => state._bookmark(id)._remove()));

        browser.windows.onCreated.addListener(evq.wrap(win => {
            // Window objects might not have IDs when queried thru the
            // browser.session API, but that doesn't happen here. #undef
            state._window(win.id!)._update(win)
        }));
        browser.windows.onRemoved.addListener(evq.wrap(
            id => state._window(id)._remove()));

        browser.tabs.onCreated.addListener(evq.wrap(tab => {
            // Tab objects might not have IDs when queried thru the
            // browser.session API, but that doesn't happen here. #undef
            state._tab(tab.id!)._update(tab);
        }));
        browser.tabs.onAttached.addListener(evq.wrap((id, info) => {
            state._tab(id)._update({windowId: info.newWindowId,
                                    index: info.newPosition});
        }));
        browser.tabs.onMoved.addListener(evq.wrap((id, info) => {
            state._tab(id)._update({windowId: info.windowId,
                                    index: info.toIndex});
        }));
        browser.tabs.onRemoved.addListener(
            evq.wrap(id => state._tab(id)._remove()));
        browser.tabs.onReplaced.addListener(
            evq.wrap((new_id, old_id) => state._tab_replaced(new_id, old_id)));
        browser.tabs.onUpdated.addListener(
            evq.wrap((id, info, tab) => state._tab(id)._update(tab)));

        //
        // Once event handlers are setup, we can construct the state object.
        // This is an asynchronous process, so events that are delivered while
        // we are querying bookmarks, tabs, etc. will be queued and processed
        // once we have a complete state.
        //

        const p = await namedPromises({
            bm: browser.bookmarks.getSubTree(""),
            wins: browser.windows.getAll(
                {populate: true, windowTypes: ['normal']}),
        });

        state = new StashState(p.bm[0], p.wins, Cache.open('favicons'));

        // Once we have finished building the state object, bring it up-to-date
        // with any events that were delivered while we were querying the
        // browser.
        evq.unplug();

        return state;
    }

    //
    // PRIVATE IMPLEMENTATION PAST THIS POINT.
    //

    // Don't call this (except for testing).  Call make() instead.
    constructor(bookmarks_root: browser.bookmarks.BookmarkTreeNode,
                windows: browser.windows.Window[],
                favicons: FaviconCache)
    {
        this.favicon_cache = favicons;

        this.bookmarks = this._bookmark(bookmarks_root.id);
        this.bookmarks._update(bookmarks_root);

        // Populates wins_by_id
        for (let win of windows) {
            if (win.id === undefined) continue; // Special/devtools window
            this._window(win.id)._update(win);
        }
    }

    _bookmark(id: string): Bookmark {
        return this.bms_by_id.get(id) || new Bookmark(this, id);
    }

    _window(id: number): Window {
        return this.wins_by_id.get(id) || new Window(this, id);
    }

    _tab(id: number): Tab {
        return this.tabs_by_id.get(id) || new Tab(this, id);
    }

    _tab_replaced(new_id: number, old_id: number) {
        let i = this.tabs_by_id.get(old_id);
        if (! i) return;
        this.tabs_by_id.delete(old_id);
        this.tabs_by_id.set(new_id, i);
        i.id = new_id;
    }

    _reposition(item: ModelLeaf,
                newParentId: string | number | undefined,
                newIndex: number | undefined)
    {
        // NOTE: We expect to see new parents before we see any of their
        // children.  Children will not get linked properly into parents that
        // don't exist yet.

        // Find the new parent (even if it's the same as the old, or no parent)
        let new_parent = undefined;
        if (newIndex !== undefined && newIndex >= 0) {
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
                if (item instanceof Tab) {
                    new_parent = this._window(newParentId as number);
                } else {
                    new_parent = this._bookmark(newParentId as string);
                }
            }

        } else {
            console.assert(newParentId === undefined,
                           "Must specify an index when specifying a parent");
        }

        // At this point, /new_parent/ is pointing to the window where the tab
        // is being moved to (even if that's the same as the old window).  Now
        // it's just a matter of moving the tab to the right position, and
        // re-shuffling the indices of the other tabs in that window
        // accordingly.

        // First remove from the old parent
        if (item.parent) {
            const children = item.parent.children;
            if (children) {
                let idx = children.indexOf(item);
                if (idx >= 0) {
                    children.splice(idx, 1);
                    for (let i = idx; i < children.length; ++i) {
                        if (children[i]) children[i]!.index = i;
                    }
                }
            }
            item.parent = undefined;
            item.index = undefined;
        }

        // Then add to the new
        if (new_parent && newIndex !== undefined) {
            const children = new_parent.children || (new_parent.children = []);

            while (children.length < newIndex) children.push(undefined);
            children.splice(newIndex, 0, item);
            for (let i = newIndex + 1; i < children.length; ++i) {
                if (children[i]) children[i]!.index = i;
            }

            item.parent = new_parent;
            item.index = newIndex;
        }
    }

    _update_url(i: ModelLeaf, url?: string) {
        if (i.related) {
            let idx = i.related.indexOf(i);
            console.assert(idx >= 0);
            i.related.splice(idx, 1);
            // Safe to assume we have a URL here since delete(undefined) is
            // mostly harmless. #undef
            if (i.related.length <= 0) {
                this.items_by_url.delete(urlToOpen(i.url!));
            }
        }

        if (url) {
            const ourl = urlToOpen(url);
            let related = this.items_by_url.get(ourl);
            if (! related) {
                related = [];
                this.items_by_url.set(ourl, related);
            }
            related.push(i);

            i.url = url;
            i.related = related;
            try {
                i.favicon = this.favicon_cache.get(ourl);
            } catch (e) {
                i.favicon = undefined;
            }

        } else {
            i.url = undefined;
            i.related = undefined;
            i.favicon = undefined;
        }
    }
}
