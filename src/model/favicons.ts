import {urlToOpen} from '../util';

import {KVSCache, Entry} from '../datastore/kvs';
import * as Tabs from './tabs';

/** The persistent cache which holds favicons, keyed by URL. */
export type FaviconCache = KVSCache<string, Favicon>;

/** A (reactive) entry in the favicon cache.  Its value property is updated when
 * the favicon for the URL changes. */
export type Favicon = {favIconUrl: string | null, atime: number};

/** The actual entry stored in the KVS (well, sans null). */
export type FaviconEntry = Entry<string, Favicon | null>;

/** A cache of favicons, indexed by URL.  Used to locate suitable icons to show
 * alongside bookmarks.
 *
 * URLs in the cache are stored normalized (by passing to urlToOpen()), since
 * some URLs might be "privileged" URLs which Tab Stash can't actually open as
 * tabs.  However, we still want to be able to use the same favicon for the
 * privileged and unprivileged URLs, so everything looks as consistent as
 * possible to the user.
 */
export class Model {
    private readonly _tabs: Tabs.Model;
    private readonly _kvc: FaviconCache;

    constructor(tabs: Tabs.Model, kvc: FaviconCache) {
        this._tabs = tabs;
        this._kvc = kvc;

        this._tabs.by_id.onInsert.addListener((_id, tab) => this._updateFavicon(tab));
        this._tabs.by_id.onUpdate.addListener((_id, tab) => this._updateFavicon(tab));
        for (const [_id, tab] of this._tabs.by_id) this._updateFavicon(tab);
    }

    // TODO garbage collection in the service worker

    /** Retrieve a favicon from the cache.
     *
     * This always returns an object, but the object's .value property might not
     * be filled in if we don't know what icon to use (yet).  Once the icon is
     * known, the returned object will be filled in (and the change will be
     * visible to Vue's reactivity system).
     */
    get(url: string): FaviconEntry {
        let ent = this._kvc.get(urlToOpen(url));

        // Stamp our updated atime (don't worry, it's lazy, and we stamp at most
        // once per minute...)
        const now = Date.now();
        if (ent.value && ent.value.atime < now - 60000) {
            ent.value.atime = now;
            this._kvc.set(url, ent.value);
        }
        return ent;
    }

    /** Update the icon for a URL in the cache. */
    set(url: string, favIconUrl: string): FaviconEntry {
        return this._kvc.set(url, {favIconUrl, atime: Date.now()});
    }

    /** Set the icon for a URL in the cache, but only if it doesn't have one
     * already. */
    maybeSet(url: string, favIconUrl: string) {
        this._kvc.maybeInsert(url, {favIconUrl, atime: Date.now()});
    }

    private _updateFavicon(tab: Tabs.Tab) {
        // We ignore favicons when the tab is still loading, because Firefox may
        // send us events where a tab has a new URL, but an old favicon which is
        // for the URL the tab is navigating away from.
        if (tab.url && tab.favIconUrl && tab.status === 'complete') {
            this.set(tab.url, tab.favIconUrl);
        }
    }
}
