import {defineComponent, h, type PropType, type VNode} from "vue";

import {delimit, required} from "../../util/index.js";
import type {StashItem, StashLeaf, StashParent} from "../../model/index.js";
import {br, getParentInfo, splitItems} from "./helpers.js";

const MD_LINK_QUOTABLES_RE = /\\|\[|\]|\&|\<|\>/g;
const MD_URL_QUOTABLES_RE = /\\|\)/g;

function renderParent(level: number, folder: StashParent): VNode {
  const {title, leaves, parents} = getParentInfo(folder);

  return h("div", {}, [
    h("div", {}, [`${"".padStart(level, "#")} ${quote_title(title)}`]),
    ...leaves.map(renderLeaf),
    ...(parents.length > 0 ? [br()] : []),
    ...delimit(
      br,
      parents.map(f => renderParent(level + 1, f)),
    ),
  ]);
}

function renderLeaf(node: StashLeaf): VNode {
  return h("div", {}, [
    `- [${quote_title(node.title || node.url)}](`,
    h("a", {href: node.url}, [quote_url(node.url)]),
    `)`,
  ]);
}

function quote_emphasis(text: string): string {
  return text
    .replace(
      /(^|\s)([*_]+)(\S)/g,
      (str, ws, emph, rest) => `${ws}${emph.replace(/./g, "\\$&")}${rest}`,
    )
    .replace(
      /(\S)([*_]+)(\s|$)/g,
      (str, rest, emph, ws) => `${rest}${emph.replace(/./g, "\\$&")}${ws}`,
    );
}
function quote_title(text: string): string {
  return quote_emphasis(text.replace(MD_LINK_QUOTABLES_RE, x => `\\${x}`));
}
function quote_url(url: string): string {
  return url.replace(MD_URL_QUOTABLES_RE, x => `\\${x}`);
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
