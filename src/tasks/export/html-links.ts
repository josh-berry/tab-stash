import {defineComponent, h, type PropType, type VNode} from "vue";

import {
  type StashItem,
  type StashLeaf,
  type StashParent,
} from "../../model/index.js";
import {getParentInfo, renderItems} from "./helpers.js";
import {required} from "../../util/index.js";

function renderParent(level: number, folder: StashParent): VNode {
  const {title, leaves, parents} = getParentInfo(folder);
  return h("section", {}, [
    h(`h${level}`, {}, [title]),
    h("ul", {}, leaves.map(renderLeaf)),
    ...parents.map(f => renderParent(Math.min(level + 1, 5), f)),
  ]);
}

function renderLeaf(node: StashLeaf): VNode {
  return h("li", {}, [h("a", {href: node.url}, [node.title])]);
}

export default defineComponent(
  (props: {items: StashItem[]}) => {
    return () =>
      renderItems(props.items, {
        parent: p => [renderParent(2, p)],
        leaf: l => [renderLeaf(l)],
      });
  },
  {props: {items: required(Array as PropType<StashItem[]>)}},
); // TODO: add type for items
