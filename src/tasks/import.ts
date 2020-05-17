import { TaskMonitor } from '../util';
import { bookmarkTabs, isURLStashable } from '../stash';
import { fetchInfoForSites } from './siteinfo';
import { Cache } from '../cache-client';
import { FaviconCache } from '../model';

type Bookmark = browser.bookmarks.BookmarkTreeNode;

// This is based on RFC 3986, but is rather more permissive in some ways,
// because CERTAIN COMPANIES (looking at you, Office365 with your un-encoded
// "{uuid}" nonsense...) will put illegal characters in their URLs and everyone
// just sort of tolerates it.
//
// It's also rather more restrictive, because we we ignore data: and other URIs
// which have no authority (the "//foo.com" part before the path).
//
// So if we see something that starts out looking like a valid protocol,
// followed by "://", we just take everything after the "://" as part of the
// URL, up to a set of commonly-used terminator characters (e.g. quotes, closing
// brackets/parens, or whitespace).
const URL_RE = /[a-zA-Z][-a-zA-Z0-9+.]*:\/\/[^\]\) \t\n\r"'>]+/g;

const MARKDOWN_HEADER_RE = /^#+ (.*)$/;

export type ParseOptions = {
    splitOn: '' | 'h' | 'p+h',
};

export type BookmarkGroup = {
    title?: string,
    urls: string[],
};

export function parse(node: Node,
                      options?: Partial<ParseOptions>): BookmarkGroup[]
{
    const parser = new Parser(options);
    parser.parseChildren(node);
    return parser.end();
}

class Parser {
    readonly options: ParseOptions = {
        splitOn: 'p+h',
    };

    building: BookmarkGroup = {urls: []};
    built: BookmarkGroup[] = [];
    afterBR: boolean = false;

    constructor(options?: Partial<ParseOptions>) {
        if (options) this.options = Object.assign({}, this.options, options);
    }

    end(): BookmarkGroup[] {
        this.endGroup();
        return this.built
            .filter(group => group.urls.length > 0)
            .map(group => {
                group.urls = Array.from(new Set(
                    group.urls.filter(isURLStashable)));
                return group;
            });
    }

    endGroup(titleForNextGroup?: string) {
        this.built.push(this.building);
        this.building = {
            title: titleForNextGroup,
            urls: []
        };
    }

    parseChildren(node: Node) {
        for (const child of node.childNodes) {
            switch (child.nodeType) {
                case Node.ELEMENT_NODE:
                    const el = child as Element;
                    this.parseElement(el);
                    break;

                case Node.TEXT_NODE:
                    const text = child.nodeValue?.trim();
                    if (! text) continue;

                    this.afterBR = false;

                    if (['h', 'p+h'].includes(this.options.splitOn)) {
                        const header = text.match(MARKDOWN_HEADER_RE);
                        if (header) this.endGroup(header[1]?.trim());
                    }

                    for (const url of extractURLs(text)) {
                        this.building.urls.push(url);
                    }
                    break;

                default:
                    // TODO
                    break;
            }
        }
    }

    parseElement(el: Element) {
        switch (el.localName) {
            case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
                if (['h', 'p+h'].includes(this.options.splitOn)) {
                    this.endGroup(el.textContent ?? undefined);
                } else {
                    this.parseChildren(el);
                }
                break;

            case 'p':
                this.parseChildren(el);
                if (this.options.splitOn === 'p+h') this.endGroup();
                break;

            case 'br':
                if (this.afterBR) {
                    if (this.options.splitOn === 'p+h') this.endGroup();
                    this.afterBR = false;
                } else {
                    this.afterBR = true;
                }
                this.parseChildren(el);
                break;

            case 'a':
                const a = el as HTMLAnchorElement;
                if (a.href) {
                    this.building.urls.push(a.href);
                }
                this.parseChildren(el);
                break;

            default:
                this.parseChildren(el);
                break;
        }

        if (el.localName !== 'br') this.afterBR = false;
    }
}

export function* extractURLs(str: string): Generator<string> {
    const re = new RegExp(URL_RE);
    let m;
    while ((m = re.exec(str)) !== null) {
        yield m[0];
    }
}

export async function importURLs(groups: BookmarkGroup[], tm: TaskMonitor):
    Promise<void>
{
    tm.status = 'Importing tabs...';
    tm.max = 100;

    // We reverse the order of groups on import because the text/URLs that show
    // up at the top of the imported list will also show up at the top of the
    // stash.  Otherwise, the last folder to be created will show up first (so
    // groups will appear "backwards" once imported).
    const groups_rev = groups.reverse();
    const urls = flat(groups_rev.map(g => g.urls));
    const urlset = new Set(urls);

    // We start three tasks in parallel: Bookmark creation, fetching of site
    // information, and updating bookmarks with titles, favicons, etc.

    // Task: Creating bookmarks
    const create_bms_p = tm.wspawn(25, async tm => {
        tm.status = "Creating stash folders...";
        tm.max = groups_rev.length;
        const bm_groups = [];
        for (const g of groups_rev) {
            bm_groups.push((await tm.spawn(tm => bookmarkTabs(
                undefined,
                g.urls.map(url => ({url, title: "Importing..."})),
                {newFolderTitle: g.title, taskMonitor: tm}))).bookmarks);
        }
        return flat(bm_groups);
    });

    // Task: Fetching site info
    const siteinfo_aiter = tm.wspawn_iter(50, tm => fetchInfoForSites(urlset, tm));

    // Task: Updating bookmarks with site info.  This task awaits the other two
    // tasks and brings their results together, so we await on this task
    // directly here.
    await tm.wspawn(25, async tm => {
        tm.status = "Updating bookmarks...";

        const bms = await create_bms_p;
        const bms_by_url = new Map<string, Bookmark[]>();

        tm.max = bms.length;
        for (const bm of bms) {
            const v = bms_by_url.get(bm.url!);
            if (v) {
                v.push(bm);
            } else {
                bms_by_url.set(bm.url!, [bm]);
            }
        }

        const favicon_cache: FaviconCache = Cache.open('favicons');
        for await (const siteinfo of siteinfo_aiter) {
            const url = siteinfo.finalUrl || siteinfo.originalUrl;

            if (siteinfo.title || siteinfo.finalUrl) {
                const title = siteinfo.title || siteinfo.originalUrl;
                for (const bm of bms_by_url.get(siteinfo.originalUrl)!) {
                    await browser.bookmarks.update(bm.id, {url, title});
                }
            }
            if (siteinfo.favIconUrl) favicon_cache.set(url, siteinfo.favIconUrl);

            ++tm.value;
        }
    });
}

// Polyfill for Array.flat(), which isn't available in FF 61.
function flat<T>(a: T[][]): T[] {
    return a.reduce((a, v) => a.concat(v), []);
}
