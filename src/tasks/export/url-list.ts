import {defineComponent, h, type PropType, type VNode} from "vue";

import {delimit, required} from "../../util/index.js";
import type {StashItem, StashLeaf, StashParent} from "../../model/index.js";
import {br, getParentInfo, splitItems} from "./helpers.js";

function renderParent(level: number, folder: StashParent): VNode {
  const {title, leaves, parents} = getParentInfo(folder);
  return h("div", {}, [
    h("div", {}, [`${"".padStart(level, "#")} ${title}`]),
    ...leaves.map(renderLeaf),
    ...(leaves.length > 0 && parents.length > 0 ? [br()] : []),
    ...delimit(
      br,
      parents.map(f => renderParent(level + 1, f)),
    ),
  ]);
}

function renderLeaf(node: StashLeaf): VNode {
  return h("div", {}, [h("a", {href: node.url}, [node.url])]);
}

export default defineComponent(
  (props: {items: StashItem[]}) => {
    return () => {
      const {leaves, parents} = splitItems(props.items);
      return [
        ...leaves.map(renderLeaf),
        ...(parents.length > 0 && leaves.length > 0 ? [br()] : []),
        ...delimit(
          br,
          parents.map(p => renderParent(2, p)),
        ),
      ];
    };
  },
  {props: {items: required(Array as PropType<StashItem[]>)}},
);
