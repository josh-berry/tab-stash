import browser, {Tabs} from 'webextension-polyfill';

import {AsyncChannel, TaskMonitor, Task} from '../util';

// How many concurrent fetches do we want to allow?
const MAX_CONCURRENT_FETCHES = 4;

// How long do we wait for initial loading of the tab to complete?
const LOADING_TIMEOUT = 30000; /* ms */

// Once a tab is loaded, if we still don't have a favicon, how long do we wait
// for the tab to set one?
const FAVICON_TIMEOUT = 2000; /* ms */

// If the browser replaces a tab with another tab (e.g. due to Firefox
// Multi-Account Containers), how long do we wait for the replacement tab to
// show up?  (This is independent of the other timeouts, which may still fire
// while we are waiting for this one.)
const REPLACEMENT_TIMEOUT = 3000; /* ms */

export type SiteInfo = {
    complete?: boolean; // true = loading completed, false/undef = timed out/error
    originalUrl: string;
    finalUrl?: string;
    title?: string;
    favIconUrl?: string;
    error?: unknown;
};

export function fetchInfoForSites(urlset: Set<string>, tm: TaskMonitor):
    AsyncIterableIterator<SiteInfo>
{
    const urls = Array.from(urlset);
    const chan = new AsyncChannel<SiteInfo>();

    const max = urls.length;
    tm.status = "Fetching site info...";
    tm.max = max;

    const parent_tm = tm; // Hack to allow checking for cancellation
    const fiber = async (tm: TaskMonitor) => {
        tm.max = max;
        while (urls.length > 0) {
            const url = urls.pop()!;
            tm.status = url;
            for (let retry_count = 3; retry_count > 0; ) {
                try {
                    chan.send(await fetchSiteInfo(url));
                    break;
                } catch (e) {
                    --retry_count;
                    if (retry_count > 0) continue;
                    chan.send({
                        originalUrl: url,
                        error: e,
                    });
                    break;
                }
            }
            tm.value = max - urls.length;
            if (parent_tm.cancelled) break;
        }
    };

    let fiber_count = Math.min(MAX_CONCURRENT_FETCHES, urls.length);
    const fiber_weight = urls.length/fiber_count;

    const fibers: Task<void>[] = [];
    for (let i = 0; i < fiber_count; ++i) {
        fibers.push(tm.wspawn(fiber_weight, tm => fiber(tm).finally(() => {
            --fiber_count;
            if (fiber_count == 0) chan.close();
        })));
    }

    // If there are no sites to fetch / no fibers created, close the channel
    // immediately.  Otherwise the channel will remain open and the caller will
    // block forever (since the `chan.close()` above will never run).
    if (fibers.length === 0) chan.close();

    tm.onCancel = () => fibers.forEach(f => f.cancel());

    return chan;
}

// Fetch the title and favicon of a site by loading the site in a new temporary
// tab.  The tab should not be used for anything else until this function's
// Promise resolves.
//
// If the tab is closed before site info can be fetched, a TabRemovedError will
// be thrown.  (Note: Typically this only happens if a user closes the tab by
// mistake; tabs which are replaced e.g. by Firefox Containers re-opening the
// tab automatically in the right container are automatically handled without
// throwing TabRemovedError.)
export async function fetchSiteInfo(url: string): Promise<SiteInfo> {
    let events: AsyncChannel<TabEvent> | undefined = undefined;
    let tab: Tabs.Tab | undefined = undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined = undefined;

    const onTimeout = () => {
        trace('timeout', url);
        if (events) events.close();
    };

    const info: SiteInfo = {
        complete: false,
        originalUrl: url,
        finalUrl: undefined,
        title: undefined,
        favIconUrl: undefined,
    };

    const capture_info = (tab: Tabs.Tab) => {
        trace('capturing', {
            status: tab.status,
            title: tab.title,
            url: tab.url,
            favicon: tab.favIconUrl ? tab.favIconUrl.substr(0, 10) : undefined,
        });

        if (tab.url && tab.url !== 'about:blank') info.finalUrl = tab.url;
        if (info.finalUrl) {
            if (tab.title) info.title = tab.title;
            if (tab.favIconUrl) info.favIconUrl = tab.favIconUrl;
            if (tab.status === 'complete') {
                info.complete = true;
                if (timeout) clearTimeout(timeout);
                timeout = setTimeout(onTimeout, FAVICON_TIMEOUT);
            }
        }
        trace('current best', info);
    };

    const has_complete_info = () => info.finalUrl && info.title && info.favIconUrl;

    try {
        events = watchForTabEvents();
        tab = await browser.tabs.create({active: false, url});
        if (browser.tabs.hide) await browser.tabs.hide(tab.id!);
        timeout = setTimeout(onTimeout, LOADING_TIMEOUT);

        // Watch for tab events until the timeout above fires or we get a
        // complete set of tab info.  When the timeout fires, the channel will
        // be closed and we will automatically exit the loop.
        for await (const ev of events) {
            if (ev.id !== tab.id) continue;

            switch (ev.$type) {
                case 'create':
                case 'update':
                    capture_info(ev.tab);
                    break;

                case 'replace':
                    trace('replace', ev.id, '=>', ev.replacedWith);
                    tab = await browser.tabs.get(ev.replacedWith);
                    break;

                case 'remove':
                    // If our tab was removed, wait a bit and try to find an
                    // already-open replacement.  This can happen if, for
                    // example, the Multi-Account Containers extension decides
                    // to remove and re-open a site in a new tab in the proper
                    // container. [#91]
                    //
                    // If we cannot find a replacement, this will close /events/
                    // and return undefined, and we'll break out of the loop.
                    tab = await findReplacementTab(events, url);
                    if (tab) capture_info(tab);
                    else throw new TabRemovedError(url);
                    break;
            }

            if (has_complete_info()) break;
        }

    } finally {
        if (timeout) clearTimeout(timeout);
        if (tab) browser.tabs.remove(tab.id!).catch(console.error);
        if (events) events.close();
    }

    trace('final info', info);
    return info;
}

async function findReplacementTab(
    events: AsyncChannel<TabEvent>, url: string
): Promise<Tabs.Tab | undefined> {
    const access_cutoff = Date.now() - 500;
    const timeout = setTimeout(() => {
        trace('replacement timed out', url);
        events.close();
    }, REPLACEMENT_TIMEOUT);
    try {
        // First we check if the tab has already been reopened elsewhere, and if
        // so, we can return it immediately.
        const recent_tabs = (await browser.tabs.query({currentWindow: true}))
            .filter(tab => (tab.lastAccessed ?? 0) >= access_cutoff
                        && tab.url === url);
        trace('immediate replacement candidates', recent_tabs);
        if (recent_tabs.length > 0) return recent_tabs[0];

        // Otherwise we watch ALL tabs until the timeout to see if ANY of them
        // navigate to our desired URL.  If so, and if the tab was accessed
        // recently, we assume that tab is the one that replaced ours.
        //
        // We're explicitly not checking the cookie store ID, because it may not
        // be reliable (don't know, for instance, which container the target tab
        // would be in; it might even be the default for some weird reason).
        for await (const ev of events) {
            if (! ('tab' in ev)) continue;
            if ((ev.tab.lastAccessed ?? 0) < access_cutoff) {
                trace('searching for replacement - too old', ev)
                continue;
            }
            if (ev.tab.url === url) {
                trace('found replacement', ev);
                return ev.tab;
            }
        }

        // Couldn't find a replacement in time
        trace('no replacement found');
        events.close();
        return undefined;

    } finally {
        clearTimeout(timeout);
    }
}

export class TabRemovedError extends Error {
    url: string;

    constructor(url: string) {
        super(`Tab was removed after navigating to ${url}`);
        this.url = url;
    }
}

type TabEvent = TabCreated | TabUpdated | TabReplaced | TabRemoved;
type TabCreated = {$type: 'create', id: number, tab: Tabs.Tab};
type TabUpdated = {$type: 'update', id: number, tab: Tabs.Tab};
type TabReplaced = {$type: 'replace', id: number, replacedWith: number};
type TabRemoved = {$type: 'remove', id: number};

function watchForTabEvents(): AsyncChannel<TabEvent> {
    const chan = new AsyncChannel<TabEvent>();

    const onCreated = (tab: Tabs.Tab) =>
        chan.send({$type: 'create', id: tab.id!, tab});
    const onUpdated = (id: number, info: {}, tab: Tabs.Tab) =>
        chan.send({$type: 'update', id, tab});
    const onReplaced = (replacedWith: number, id: number) =>
        chan.send({$type: 'replace', replacedWith, id});
    const onRemoved = (id: number) =>
        chan.send({$type: 'remove', id});

    chan.onClose = () => {
        browser.tabs.onCreated.removeListener(onCreated);
        browser.tabs.onUpdated.removeListener(onUpdated);
        browser.tabs.onReplaced.removeListener(onReplaced);
        browser.tabs.onRemoved.removeListener(onRemoved);
    };
    browser.tabs.onCreated.addListener(onCreated);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onReplaced.addListener(onReplaced);
    browser.tabs.onRemoved.addListener(onRemoved);

    return chan;
}

function trace(...args: any[]) {
    if (! (<any>globalThis).trace_siteinfo) return;
    console.log('[siteinfo]', ...args);
}
//(<any>globalThis).trace_siteinfo = true;
