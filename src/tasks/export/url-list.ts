import {defineComponent, h, type PropType, type VNode} from "vue";

import {delimit, required} from "../../util/index.js";
import {br, type ExportBookmark, type ExportFolder} from "./model.js";

function renderFolder(level: number, folder: ExportFolder): VNode {
  return h("div", {}, [
    h("div", {}, [`${"".padStart(level, "#")} ${folder.title}`]),
    ...folder.bookmarks.map(renderBookmark),
    ...(folder.folders.length > 0 ? [br()] : []),
    ...delimit(
      br,
      folder.folders.map(f => renderFolder(level + 1, f)),
    ),
  ]);
}

function renderBookmark(node: ExportBookmark): VNode {
  return h("div", {}, [h("a", {href: node.url}, [node.url])]);
}

export default defineComponent({
  props: {
    folders: required(Object as PropType<ExportFolder[]>),
  },

  setup(props) {
    return () =>
      delimit(
        br,
        props.folders.map(f => renderFolder(2, f)),
      );
  },
});
