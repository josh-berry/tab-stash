import {h, type VNode} from "vue";

import {
  isLeaf,
  isParent,
  type StashItem,
  type StashLeaf,
  type StashParent,
} from "../../model/index.js";
import {filterMap} from "../../util/index.js";
import {friendlyFolderName} from "../../model/bookmarks.js";

export interface Renderers {
  parent: (item: StashParent) => VNode[];
  leaf: (item: StashLeaf) => VNode[];
}

export function renderItems(items: StashItem[], renderers: Renderers): VNode[] {
  const {leaves, parents} = splitItems(items);
  return [
    ...leaves.flatMap(i => renderers.leaf(i)),
    ...parents.flatMap(i => renderers.parent(i)),
  ];
}

export function getParentInfo(folder: StashParent): {
  title: string;
  leaves: StashLeaf[];
  parents: StashParent[];
} {
  const title =
    "title" in folder ? friendlyFolderName(folder.title) : "Untitled";
  const {leaves, parents} = splitItems(folder.children);
  return {title, leaves, parents};
}

export function splitItems(items: readonly (StashItem | undefined)[]): {
  leaves: StashLeaf[];
  parents: StashParent[];
} {
  const leaves = filterMap(items, c => {
    if (c && isLeaf(c)) return c;
    return undefined;
  });
  const parents = filterMap(items, c => {
    if (c && isParent(c)) return c;
    return undefined;
  });
  return {leaves, parents};
}

export function br(): VNode {
  return h("div", {}, [h("br")]);
}
