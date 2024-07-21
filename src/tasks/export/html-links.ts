import {defineComponent, h, type PropType, type VNode} from "vue";

import {required} from "../../util/index.js";
import type {ExportBookmark, ExportFolder} from "./model.js";

function renderFolder(level: number, folder: ExportFolder): VNode {
  return h("section", {}, [
    h(`h${level}`, {}, [folder.title]),
    h("ul", {}, folder.bookmarks.map(renderBookmark)),
    ...folder.folders.map(f => renderFolder(Math.min(level + 1, 5), f)),
  ]);
}

function renderBookmark(node: ExportBookmark): VNode {
  return h("li", {}, [h("a", {href: node.url}, [node.title])]);
}

export default defineComponent({
  props: {
    folders: required(Object as PropType<ExportFolder[]>),
  },

  setup(props) {
    return () => props.folders.map(f => renderFolder(2, f));
  },
});
