import {defineComponent, h, type PropType, type VNode} from "vue";

import type {StashItem, StashLeaf} from "../../model/index.js";
import {br, splitItems} from "./helpers.js";
import {delimit, required} from "../../util/index.js";

function renderItems(items: (StashItem | undefined)[]): VNode {
  const {leaves, parents} = splitItems(items);
  return h("div", [
    ...leaves.map(renderBookmark),
    ...(parents.length > 0 && leaves.length > 0 ? [br()] : []),
    ...delimit(
      br,
      parents.map(p => renderItems(p.children)),
    ),
  ]);
}

function renderBookmark(node: StashLeaf): VNode {
  return h("div", {}, [
    h("a", {href: node.url}, [node.url]),
    ` | ${node.title}`,
  ]);
}

export default defineComponent(
  (props: {items: StashItem[]}) => {
    return () => renderItems(props.items);
  },
  {props: {items: required(Array as PropType<StashItem[]>)}},
);
