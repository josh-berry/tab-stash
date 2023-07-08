import {filterMap} from "../util";

import {isNode, isTab, isWindow, type ModelItem} from "../model";
import type * as BM from "../model/bookmarks";
import type * as T from "../model/tabs";

const NATIVE_TYPE = "application/x-tab-stash-dnd-items";

export const ACCEPTS = [NATIVE_TYPE] as readonly string[];

type DNDItem = DNDWindow | DNDTab | DNDBookmarkNode;

type DNDWindow = {window: T.WindowID};
type DNDTab = {tab: T.TabID};
type DNDBookmarkNode = {node: BM.NodeID};

export function sendDragData(dt: DataTransfer, items: ModelItem[]) {
  const data: DNDItem[] = items.map(i => {
    if (isNode(i)) return {node: i.id};
    if (isTab(i)) return {tab: i.id};
    if (isWindow(i)) return {window: i.id};
    throw new Error(`Trying to drag unrecognized model item: ${i}`);
  });
  dt.setData(NATIVE_TYPE, JSON.stringify(data));
}

export function recvDragData(
  dt: DataTransfer,
  model: {bookmarks: BM.Model; tabs: T.Model},
): ModelItem[] {
  const blob = dt.getData(NATIVE_TYPE);
  let data: DNDItem[];
  try {
    data = JSON.parse(blob) as DNDItem[];
    if (!(data instanceof Array)) return [];
  } catch (e) {
    data = [] as DNDItem[];
  }

  return filterMap(data, i => {
    if (typeof i !== "object" || i === null) return undefined;
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
}
