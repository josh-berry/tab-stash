import browser, {Tabs} from 'webextension-polyfill';

import {urlToOpen} from '../util';
import {logErrorsFrom} from "../util/oops";

import {KVSCache, Entry} from '../datastore/kvs';

/** The persistent cache which holds favicons, keyed by URL. */
export type FaviconCache = KVSCache<string, Favicon>;

/** A (reactive) entry in the favicon cache.  Its value property is updated when
 * the favicon for the URL changes. */
export type Favicon = {favIconUrl: string | null};

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
    private readonly _kvc: FaviconCache;

    constructor(kvc: FaviconCache) {
        this._kvc = kvc;

        browser.tabs.onCreated.addListener(tab => this._updateFavicon(tab));
        browser.tabs.onUpdated.addListener((_id, _info, tab) => this._updateFavicon(tab));

        void logErrorsFrom(async () => {
            for (const tab of await browser.tabs.query({})) {
                this._updateFavicon(tab);
            }
        });
    }

    /** Removes favicons for whom `keep(url)` returns false. */
    async gc(keep: (url: string) => boolean) {
        const toDelete = [];

        for await (const entry of this._kvc.kvs.list()) {
            if (keep(entry.key)) continue;
            toDelete.push(entry.key);
        }

        await this._kvc.kvs.delete(toDelete);
    }

    /** Retrieve a favicon from the cache.
     *
     * This always returns an object, but the object's .value property might not
     * be filled in if we don't know what icon to use (yet).  Once the icon is
     * known, the returned object will be filled in (and the change will be
     * visible to Vue's reactivity system).
     */
    get(url: string): FaviconEntry { return this._kvc.get(urlToOpen(url)); }

    /** Retrieves a favicon from the cache, but won't trigger loading
     * if the icon is not already present in the store. */
    getIfExists(url: string): FaviconEntry | undefined {
        return this._kvc.getIfExists(urlToOpen(url));
    }

    /** Update the icon for a URL in the cache. */
    set(url: string, favIconUrl: string): FaviconEntry {
        return this._kvc.set(url, {favIconUrl});
    }

    /** Set the icon for a URL in the cache, but only if it doesn't have one
     * already. */
    maybeSet(url: string, favIconUrl: string) {
        this._kvc.maybeInsert(url, {favIconUrl});
    }

    private _updateFavicon(tab: Tabs.Tab) {
        // We ignore favicons when the tab is still loading, because Firefox may
        // send us events where a tab has a new URL, but an old favicon which is
        // for the URL the tab is navigating away from.
        if (tab.url !== undefined && tab.url !== '' &&
            tab.favIconUrl !== '' && tab.favIconUrl !== undefined &&
            tab.status === 'complete'
        ) {
            this.set(tab.url, tab.favIconUrl);
        }
    }
}
