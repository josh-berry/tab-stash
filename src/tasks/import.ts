import browser from "webextension-polyfill";

import {AsyncChannel, filterMap, TaskMonitor} from "../util";
import {trace_fn} from "../util/debug";

import type {Model, NewFolder, NewTab} from "../model";
import * as BM from "../model/bookmarks";

import {fetchInfoForSites, type SiteInfo} from "./siteinfo";

const trace = trace_fn("import");

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
const URL_RE = "[a-zA-Z][-a-zA-Z0-9+.]*:\\/\\/[^\\]\\) \t\n\r\"'<>\\\\]+";
const MARKDOWN_LINK_RE = `\\[(?<md_title>[^\\]]+)\\]\\((?<md_url>${URL_RE})\\)`;
const ONETAB_LINK_RE = `^(?<ot_url>${URL_RE}) \\| (?<ot_title>.*)$`;
const PLAIN_URL_RE = `(?<url>${URL_RE})`;
const URL_WITH_TITLE_RE = `${MARKDOWN_LINK_RE}|${ONETAB_LINK_RE}|${PLAIN_URL_RE}`;

const MARKDOWN_HEADER_RE = /^#+ (.*)$/;

export type ParseOptions = {
  splitOn: "" | "h" | "p+h";
};

export function parse(
  node: Node,
  model: Model,
  options?: Partial<ParseOptions>,
): NewFolder[] {
  const parser = new Parser(model, options);
  parser.parseChildren(node);
  return parser.end();
}

class Parser {
  readonly model: Model;
  readonly options: ParseOptions = {
    splitOn: "p+h",
  };

  building: NewFolder = {title: "", children: []};
  built: NewFolder[] = [];
  afterBR: boolean = false;

  constructor(model: Model, options?: Partial<ParseOptions>) {
    this.model = model;
    if (options) this.options = Object.assign({}, this.options, options);
  }

  end(): NewFolder[] {
    trace("end");
    this.endGroup();
    return this.built.filter(group => group.children.length > 0);
  }

  endGroup(titleForNextGroup?: string) {
    trace("endGroup", {titleForNextGroup});
    this.built.push(this.building);
    this.building = {title: titleForNextGroup ?? "", children: []};
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
          if (!text) continue;
          trace("text_node", {text});

          this.afterBR = false;

          if (["h", "p+h"].includes(this.options.splitOn)) {
            const header = text.match(MARKDOWN_HEADER_RE);
            if (header) {
              trace("text_node found header", header);
              this.endGroup(header[1]?.trim());
            }
          }

          for (const link of extractURLs(text)) {
            trace("text_node found url", link);
            this.building.children.push(link);
          }
          break;

        default:
          // TODO
          break;
      }
    }
  }

  parseElement(el: Element) {
    trace("parsing", el.localName, el);
    switch (el.localName) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        if (["h", "p+h"].includes(this.options.splitOn)) {
          this.endGroup(el.textContent ?? undefined);
        } else {
          this.parseChildren(el);
        }
        break;

      case "p":
        this.parseChildren(el);
        if (this.options.splitOn === "p+h") this.endGroup();
        break;

      case "br":
        if (this.afterBR) {
          if (this.options.splitOn === "p+h") this.endGroup();
          this.afterBR = false;
        } else {
          this.afterBR = true;
        }
        this.parseChildren(el);
        break;

      case "a":
        const a = el as HTMLAnchorElement;
        if (a.href && a.innerText.trim()) {
          this.building.children.push({
            url: a.href,
            title: a.innerText.trim(),
          });
        } else {
          this.parseChildren(el);
        }
        break;

      default:
        this.parseChildren(el);
        break;
    }

    if (el.localName !== "br") this.afterBR = false;
  }
}

export function* extractURLs(str: string): Generator<NewTab> {
  const re = new RegExp(URL_WITH_TITLE_RE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const g = m.groups!;
    if (g.md_url) yield {url: g.md_url, title: g.md_title};
    else if (g.ot_url) yield {url: g.ot_url, title: g.ot_title};
    else if (g.url) yield {url: g.url};
  }
}

export async function importURLs(options: {
  model: Model;
  folders: NewFolder[];
  fetchIconsAndTitles: boolean;
  task: TaskMonitor;
}): Promise<void> {
  options.task.status = "Importing tabs...";
  options.task.max = 100;

  // We reverse the order of groups on import because the text/URLs that show
  // up at the top of the imported list will also show up at the top of the
  // stash.  Otherwise, the last folder to be created will show up first (so
  // groups will appear "backwards" once imported).
  const groups_rev = options.folders.reverse();

  const urls_in_tree = (f: NewFolder): string[] =>
    flat(
      f.children.map(c => {
        if ("children" in c) return urls_in_tree(c);
        return [c.url];
      }),
    );
  const urlset = new Set(flat(groups_rev.map(g => urls_in_tree(g))));

  // We start three tasks in parallel: Bookmark creation, fetching of site
  // information, and updating bookmarks with titles, favicons, etc.

  // Task: Creating bookmarks
  const create_bms_p = options.task.wspawn(25, async tm => {
    tm.status = "Creating stash folders...";
    tm.max = groups_rev.length;
    const bm_groups: {folder: BM.Folder; bookmarks: BM.Node[]}[] = [];

    for (const g of groups_rev) {
      if (tm.cancelled) break;

      const res = await tm.spawn(async tm => {
        const folder = await options.model.bookmarks.createStashFolder(
          g.title || undefined,
        );
        const bookmarks = await options.model.putItemsInFolder({
          items: g.children,
          toFolderId: folder.id,
          task: tm,
        });
        return {folder, bookmarks};
      });
      bm_groups.push(res);
    }

    return {
      bookmarks: flat(
        bm_groups.map(g =>
          filterMap(g.bookmarks, bm => (BM.isBookmark(bm) ? bm : undefined)),
        ),
      ),
      folderIds: <string[]>bm_groups.map(g => g.folder.id).filter(id => id),
    };
  });

  // Task: Fetching site info
  const siteinfo_aiter = options.task.wspawn_iter(50, tm => {
    if (options.fetchIconsAndTitles) return fetchInfoForSites(urlset, tm);

    const chan = new AsyncChannel<SiteInfo>();
    chan.close();
    return chan;
  });

  // Task: Updating bookmarks with site info.  This task awaits the other two
  // tasks and brings their results together.
  const update_p = options.task.wspawn(25, async tm => {
    tm.status = "Updating bookmarks...";

    const {bookmarks, folderIds} = await create_bms_p;
    const bms_by_url = new Map<string, browser.Bookmarks.BookmarkTreeNode[]>();

    tm.max = bookmarks.length;
    for (const bm of bookmarks) {
      const v = bms_by_url.get(bm.url!);
      if (v) {
        v.push(bm);
      } else {
        bms_by_url.set(bm.url!, [bm]);
      }
    }

    for await (const siteinfo of siteinfo_aiter) {
      if (siteinfo.error) {
        options.task.cancel();
        tm.cancel();

        alert(
          "Seems like an error occurred during the import.  We were " +
            "trying to import the following URL:\n\n" +
            siteinfo.originalUrl +
            "\n\n" +
            "The error was:\n\n" +
            siteinfo.error +
            "\n" +
            (<any>siteinfo.error)?.stack +
            "\n\n" +
            "Really sorry about this!  Please let us know by filing " +
            "a bug with the above error text (see the " +
            '"Help and Support" menu).  We\'ll clean up any ' +
            "imported tabs so you can try again.",
        );
      }

      if (tm.cancelled) break;

      const url = siteinfo.finalUrl || siteinfo.originalUrl;

      if (siteinfo.title || siteinfo.finalUrl) {
        const title = siteinfo.title || siteinfo.originalUrl;
        const bms = bms_by_url.get(siteinfo.originalUrl);
        if (!bms) continue;
        for (const bm of bms) {
          await browser.bookmarks.update(bm.id, {url, title});
        }
      }

      options.model.favicons.maybeSet(url, siteinfo);
      ++tm.value;
    }

    if (tm.cancelled) {
      // If we were cancelled at any point in this process, delete
      // whatever we just created. :/
      for (const fid of folderIds) browser.bookmarks.removeTree(fid);
    }
  });

  options.task.onCancel = () => {
    create_bms_p.cancel();
    siteinfo_aiter.cancel();
    update_p.cancel();
  };

  await update_p;
}

// Polyfill for Array.flat(), which isn't available in FF 61.
function flat<T>(a: T[][]): T[] {
  return a.reduce((a, v) => a.concat(v), []);
}
