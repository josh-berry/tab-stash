import {filterMap} from "../util/index.js";

import type * as BM from "../model/bookmarks.js";
import {
  copying,
  isFolder,
  isNode,
  isTab,
  isWindow,
  type ModelItem,
  type StashItem,
} from "../model/index.js";
import type * as T from "../model/tabs.js";

const MIXED_TYPE = "application/x-tab-stash-dnd-mixed";
const ONLY_FOLDERS_TYPE = "application/x-tab-stash-dnd-folders";
const ONLY_LEAVES_TYPE = "application/x-tab-stash-dnd-leaves";

type DNDItem = DNDWindow | DNDTab | DNDBookmarkNode | DNDBookmarkFolder;

type DNDWindow = {window: T.WindowID};
type DNDTab = {tab: T.TabID};
type DNDBookmarkNode = {node: BM.NodeID};
type DNDBookmarkFolder = {folder: BM.NodeID};

export function sendDragData(dt: DataTransfer, items: ModelItem[]) {
  const data: DNDItem[] = items.map(i => {
    if (isFolder(i)) return {folder: i.id};
    if (isNode(i)) return {node: i.id};
    if (isTab(i)) return {tab: i.id};
    if (isWindow(i)) return {window: i.id};
    throw new Error(`Trying to drag unrecognized model item: ${i}`);
  });

  if (data.every(i => "folder" in i)) {
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
    if ("tab" in i && typeof i.tab === "number") {
      return model.tabs.tab(i.tab);
    }
    return undefined;
  });

  if (dt.dropEffect === "copy") return copying(ret);
  return ret;
}
