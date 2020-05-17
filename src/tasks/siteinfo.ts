import {AsyncChannel, TaskMonitor} from '../util';

export type SiteInfo = {
    originalUrl: string;
    finalUrl?: string;
    title?: string;
    favIconUrl?: string;
};

export function fetchInfoForSites(url_iter: Iterable<string>, tm: TaskMonitor):
    AsyncIterableIterator<SiteInfo>
{
    const urls = Array.from(url_iter);
    const chan = new AsyncChannel<SiteInfo>();

    const max = urls.length;
    tm.status = "Fetching site info...";
    tm.max = max;

    const parent_tm = tm; // Hack to allow checking for cancellation
    const fiber = async (tm: TaskMonitor) => {
        tm.max = max;
        let tab = await browser.tabs.create({active: false});
        try {
            while (urls.length > 0) {
                const url = urls.pop()!;
                tm.status = url;
                const info = await sendTabTo(url, tab.id!);
                // We use url, not tab.url, here so that the caller can relate
                // URLs back to their original request even if the tab was
                // redirected to a different URL.
                chan.send(info);
                tm.value = max - urls.length;
                if (parent_tm.cancelled) break;
            }

        } finally {
            browser.tabs.remove(tab.id!).catch(console.error);
        }
    };

    let fiber_count = Math.min(4, urls.length);
    const fiber_weight = urls.length/fiber_count;

    for (let i = 0; i < fiber_count; ++i) {
        tm.wspawn(fiber_weight, tm => fiber(tm).finally(() => {
            --fiber_count;
            if (fiber_count == 0) chan.close();
        }));
    }

    return chan;
}

// Fetch the title and favicon of a site by loading the site in a new temporary
// tab.  The tab should not be used for anything else until this function's
// Promise resolves.
function sendTabTo(url: string, tabId: number): Promise<SiteInfo>
{
    return new Promise((resolve, reject) => {
        let timeout: any;

        let bestURL: string | undefined;
        let bestTitle: string | undefined;
        let bestIcon: string | undefined;

        const end = () => {
            const ret = {originalUrl: url, finalUrl: bestURL,
                         title: bestTitle, favIconUrl: bestIcon};
            resolve(ret);
            if (timeout) clearTimeout(timeout);
            browser.tabs.onUpdated.removeListener(handler);
        };

        const handler = (
            id: number,
            info: {},
            tab: browser.tabs.Tab
        ) => {
            if (id !== tabId) return;
            if (tab.status !== 'complete') return;

            if (tab.url) bestURL = tab.url;
            if (tab.title && tab.title !== 'New Tab') bestTitle = tab.title;
            if (tab.favIconUrl) bestIcon = tab.favIconUrl;

            if (! bestURL || ! bestTitle || ! bestIcon) {
                // Wait a bit longer to see if we get an update with a
                // favicon and title (e.g. because it's loaded asynchronously).
                if (timeout === undefined) {
                    timeout = setTimeout(end, 4000);
                }
                return;
            }

            end();
        };

        browser.tabs.update(tabId, {url})
            .then(() => {
                browser.tabs.onUpdated.addListener(handler);

                // There is a race where a tab might finish loading before we
                // reach here, so do at least one explicit fetch of tab info in
                // case this happens.
                browser.tabs.get(tabId).then(tab => {
                    if (tab.url === url && tab.status === 'complete') {
                        handler(tabId, {}, tab);
                    }
                });
            }).catch(console.error);
    });
}
