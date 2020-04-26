import { urlToOpen, TaskMonitor } from '../util';
import { bookmarkTabs } from '../stash';
import { fetchInfoForSites } from './siteinfo';
import { Cache } from '../cache-client';
import { FaviconCache } from '../model';

type Bookmark = browser.bookmarks.BookmarkTreeNode;

export function parse(str: string): string[][] {
    const lines = str.split("\n");
    const ret: string[][] = [];
    let group: string[] = [];

    for (const l of lines) {
        const m = l.match(/^\s*(\S+)/);
        if (! m || m.length < 2) {
            if (group.length > 0) {
                ret.push(group);
                group = [];
            }
        } else {
            try {
                const url = urlToOpen(new URL(m[1]).href);
                group.push(url);
            } catch (e) {}
        }
    }

    if (group.length > 0) ret.push(group);

    return ret;
}

export async function importURLs(url_groups: string[][], tm?: TaskMonitor):
    Promise<void>
{
    const urls = flat(url_groups);
    const urlset = new Set(urls);

    const create_tm = new TaskMonitor(tm, "Creating stash folders...", 0.25);
    const fetch_tm = new TaskMonitor(tm, "Fetching site info...", 0.5);
    const update_tm = new TaskMonitor(tm, "Updating bookmarks...", 0.25);

    // We start both bookmark creation and site fetching in parallel.

    const create_bms_p = (async(tm: TaskMonitor): Promise<Bookmark[]> => {
        tm.max = url_groups.length;
        const bm_groups = [];
        for (const group of url_groups) {
            bm_groups.push((await bookmarkTabs(undefined, group.map(url => ({
                url, title: "Importing..."
            })))).bookmarks);
            tm.inc();
        }
        return flat(bm_groups);
    })(create_tm);

    const siteinfo_aiter = fetchInfoForSites(urlset, fetch_tm);

    // Bookmark creation is likely to finish first, so we wait for that here.
    const bms = await create_bms_p;
    update_tm.max = bms.length;

    // Once we have all the bookmarks, we can start update their titles and the
    // favicon cache with the site info we are finding.
    const bms_by_url = new Map<string, Bookmark[]>();
    for (const bm of bms) {
        const v = bms_by_url.get(bm.url!);
        if (v) {
            v.push(bm);
        } else {
            bms_by_url.set(bm.url!, [bm]);
        }
    }

    const favicon_cache: FaviconCache = Cache.open('favicons')
    for await (const siteinfo of siteinfo_aiter) {
        const url = siteinfo.finalUrl || siteinfo.originalUrl;

        if (siteinfo.title || siteinfo.finalUrl) {
            const title = siteinfo.title || siteinfo.originalUrl;
            for (const bm of bms_by_url.get(siteinfo.originalUrl)!) {
                await browser.bookmarks.update(bm.id, {url, title});
            }
        }
        if (siteinfo.favIconUrl) favicon_cache.set(url, siteinfo.favIconUrl);

        update_tm.inc();
    }
}

// Polyfill for Array.flat(), which isn't available in FF 61.
function flat<T>(a: T[][]): T[] {
    return a.reduce((a, v) => a.concat(v), []);
}
