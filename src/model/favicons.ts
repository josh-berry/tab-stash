import type {Tabs} from "webextension-polyfill";
import browser from "webextension-polyfill";

import {urlToOpen} from "../util/index.js";
import {logErrorsFrom} from "../util/oops.js";

import type {KVSCache, MaybeEntry} from "../datastore/kvs/index.js";

/** The persistent cache which holds favicons, keyed by URL. */
export type FaviconCache = KVSCache<string, Favicon>;

/** A (reactive) entry in the favicon cache.  Its value property is updated when
 * the favicon for the URL changes.
 *
 * We keep both the favicon URL and the page title (so this is now technically
 * more than a favicon cache)... the old page title can be used for things like
 * restoring tabs with the right title without loading the page, or remembering
 * the tab title of a renamed bookmark. */
export type Favicon = {favIconUrl: string | null; title?: string};

/** The actual entry stored in the KVS. */
export type FaviconEntry = MaybeEntry<string, Favicon>;

/** A cache of favicons and page titles, indexed by URL.  Used to locate
 * suitable icons to show alongside bookmarks.
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
    browser.tabs.onUpdated.addListener((_id, _info, tab) =>
      this._updateFavicon(tab),
    );

    logErrorsFrom(async () => {
      for (const tab of await browser.tabs.query({})) {
        this._updateFavicon(tab);
      }
    });
  }

  sync(): Promise<void> {
    return this._kvc.sync();
  }

  /** Removes favicons for whom `keep(url)` returns false. */
  async gc(keep: (url: string) => boolean) {
    const toDelete = [];

    for await (const entry of this._kvc.kvs.list()) {
      if (keep(entry.key)) continue;
      toDelete.push({key: entry.key});
    }

    await this._kvc.kvs.set(toDelete);
  }

  /** Retrieve a favicon from the cache.
   *
   * This always returns an object, but the object's .value property might not
   * be filled in if we don't know what icon to use (yet).  Once the icon is
   * known, the returned object will be filled in (and the change will be
   * visible to Vue's reactivity system).
   */
  get(url: string): FaviconEntry {
    return this._kvc.get(urlToOpen(url));
  }

  /** Retrieves a favicon from the cache, but won't trigger loading
   * if the icon is not already present in the store. */
  getIfExists(url: string): FaviconEntry | undefined {
    return this._kvc.getIfExists(urlToOpen(url));
  }

  /** Update the icon and page title for a URL in the cache.  Note that the
   * update may be done in the background--that is, the returned FaviconEntry
   * may be stale. */
  set(url: string, updates: Partial<Favicon>): FaviconEntry {
    if (!updates.favIconUrl && !updates.title) {
      return this._kvc.get(urlToOpen(url));
    }

    return this._kvc.merge(urlToOpen(url), old => {
      if (!old) old = {favIconUrl: null, title: undefined};
      if (updates.favIconUrl) old.favIconUrl = updates.favIconUrl;
      if (updates.title) old.title = updates.title;
      return old;
    });
  }

  /** Set the icon and page title for a URL in the cache, but only if the URL
   * already exists in the cache and the title/icon aren't set already. */
  maybeSet(url: string, updates: Partial<Favicon>) {
    url = urlToOpen(url);
    const entry = this._kvc.getIfExists(url)?.value;
    if (!entry) return;
    this.set(url, {
      favIconUrl: entry.favIconUrl || updates.favIconUrl,
      title: entry.title || updates.title,
    });
  }

  private _updateFavicon(tab: Tabs.Tab) {
    // We ignore favicons when the tab is still loading, because Firefox may
    // send us events where a tab has a new URL, but an old favicon which is
    // for the URL the tab is navigating away from.
    if (tab.url && tab.status === "complete") this.set(tab.url, tab);
  }
}
