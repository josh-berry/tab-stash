import {defineComponent, h, type PropType, type VNode} from "vue";

import {friendlyFolderName} from "../../model/bookmarks";
import {required} from "../../util";
import type {ExportBookmark, ExportFolder} from "./model";

function renderFolder(level: number, folder: ExportFolder): VNode {
  return h("section", {}, [
    h(`h${level}`, {}, [friendlyFolderName(folder.title)]),
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
