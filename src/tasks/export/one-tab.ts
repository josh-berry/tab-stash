import {defineComponent, h, type PropType, type VNode} from "vue";

import {required} from "../../util/index.js";
import type {ExportBookmark, ExportFolder} from "./model.js";

function flattenFolders(tree: ExportFolder): ExportFolder[] {
  const r = tree.folders.flatMap(flattenFolders);
  r.unshift(tree);
  return r;
}

function renderFolder(folder: ExportFolder): VNode {
  return h("div", {}, [
    ...folder.bookmarks.map(renderBookmark),
    h("div", {}, [h("br")]),
  ]);
}

function renderBookmark(node: ExportBookmark): VNode {
  return h("div", {}, [
    h("a", {href: node.url}, [node.url]),
    ` | ${node.title}`,
  ]);
}

export default defineComponent({
  props: {
    folders: required(Object as PropType<ExportFolder[]>),
  },

  setup(props) {
    return () =>
      props.folders
        .flatMap(flattenFolders)
        .filter(f => f.bookmarks.length > 0)
        .map(renderFolder);
  },
});
