import {filterMap} from "../util";

import type {ModelItem} from "../model";
import type * as BM from "../model/bookmarks";
import type * as T from "../model/tabs";

const NATIVE_TYPE = "application/x-tab-stash-item-ids";

export const ACCEPTS = [NATIVE_TYPE] as readonly string[];

type TabStashItemIDs = (T.TabID | BM.NodeID)[];

export function sendDragData(dt: DataTransfer, items: ModelItem[]) {
  const data: TabStashItemIDs = items.map(i => i.id);
  dt.setData(NATIVE_TYPE, JSON.stringify(data));
}

export function recvDragData(
  dt: DataTransfer,
  model: {bookmarks: BM.Model; tabs: T.Model},
): ModelItem[] {
  const blob = dt.getData(NATIVE_TYPE);
  let data: unknown;
  try {
    data = JSON.parse(blob) as TabStashItemIDs;
  } catch (e) {
    data = [];
  }

  if (!(data instanceof Array)) return [];
  return filterMap(data, id => {
    if (typeof id === "string") return model.bookmarks.node(id);
    if (typeof id === "number") return model.tabs.tab(id);
    return undefined;
  });
}
