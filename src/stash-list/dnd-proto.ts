import {filterMap} from "../util/index.js";

import type * as BM from "../model/bookmarks.js";
import {copying, type ModelItem, type StashItem} from "../model/index.js";
import type * as T from "../model/tabs.js";

const MIXED_TYPE = "application/x-tab-stash-dnd-mixed";
const ONLY_FOLDERS_TYPE = "application/x-tab-stash-dnd-folders";
const ONLY_LEAVES_TYPE = "application/x-tab-stash-dnd-leaves";

type DNDItem =
  DNDWindow | DNDTabGroup | DNDTab | DNDBookmarkNode | DNDBookmarkFolder;

type DNDWindow = {window: T.WindowID};
type DNDTabGroup = {group: T.TabGroupID};
type DNDTab = {tab: T.TabID};
type DNDBookmarkNode = {node: BM.NodeID};
type DNDBookmarkFolder = {folder: BM.NodeID};

export function sendDragData(dt: DataTransfer, items: ModelItem[]) {
  const data: DNDItem[] = items.map(i => {
    if (i.type === "folder") return {folder: i.id};
    if (i.type === "bookmark" || i.type === "separator") return {node: i.id};
    if (i.type === "tab-group") return {group: i.group.id};
    if (i.type === "tab") return {tab: i.id};
    if (i.type === "window") return {window: i.id};
    throw new Error(`Trying to drag unrecognized model item: ${i}`);
  });

  if (data.every(i => "folder" in i || "group" in i || "window" in i)) {
    dt.setData(ONLY_FOLDERS_TYPE, JSON.stringify(data));
  } else if (data.every(i => "node" in i || "tab" in i)) {
    dt.setData(ONLY_LEAVES_TYPE, JSON.stringify(data));
  } else {
    dt.setData(MIXED_TYPE, JSON.stringify(data));
  }

  dt.effectAllowed = "copyMove";
}

export function dragDataType(
  dt: DataTransfer,
): "folders" | "items" | "mixed" | undefined {
  if (dt.types.includes(ONLY_FOLDERS_TYPE)) return "folders";
  if (dt.types.includes(ONLY_LEAVES_TYPE)) return "items";
  if (dt.types.includes(MIXED_TYPE)) return "mixed";
  return undefined;
}

export function recvDragData(
  dt: DataTransfer,
  model: {bookmarks: BM.Model; tabs: T.Model},
): StashItem[] {
  let blob = dt.getData(MIXED_TYPE);
  if (!blob) blob = dt.getData(ONLY_FOLDERS_TYPE);
  if (!blob) blob = dt.getData(ONLY_LEAVES_TYPE);

  let data: DNDItem[];
  try {
    data = JSON.parse(blob) as DNDItem[];
    if (!(data instanceof Array)) return [];
  } catch (e) {
    return [];
  }

  // Caches the TabGroupExtent we've seen for each group ID.
  //
  // This is kind of gross, but it allows us to avoid maintaining a reverse
  // index from TabGroup to TabGroupExtent, which is a bunch of state we don't
  // want. This is the only place where we need such a map, and DnD is a
  // relatively rare operation compared to things like rendering the UI,
  // updating the tabs model, etc. so we just pay the cost here rather than
  // having it be an additional bit of overhead.
  //
  // Most of the time, there should be only a single TGE per TG (if
  // there's not, we're either in the middle of some kind of tab-group operation
  // or the model is inconsistent).
  const tg_to_extent = new Map<T.TabGroupID, T.TabGroupExtent>();

  const all_tg_extents = (function* () {
    for (const w of model.tabs.allWindows()) {
      for (const c of w.children) {
        if (c.type !== "tab-group") continue;
        yield c;
      }
    }
  })();

  const ret: StashItem[] = filterMap(data, i => {
    if (typeof i !== "object" || i === null) return undefined;
    if ("folder" in i && typeof i.folder === "string") {
      return model.bookmarks.node(i.folder);
    }
    if ("node" in i && typeof i.node === "string") {
      return model.bookmarks.node(i.node);
    }
    if ("window" in i && typeof i.window === "number") {
      return model.tabs.window(i.window);
    }
    if ("group" in i && typeof i.group === "number") {
      let cached = tg_to_extent.get(i.group);
      while (!cached) {
        const next = all_tg_extents.next();
        if (next.done) break;
        tg_to_extent.set(next.value.group.id, next.value);
        cached = tg_to_extent.get(i.group);
      }
      return cached;
    }
    if ("tab" in i && typeof i.tab === "number") {
      return model.tabs.tab(i.tab);
    }
    return undefined;
  });

  if (dt.dropEffect === "copy") return copying(ret);
  return ret;
}
