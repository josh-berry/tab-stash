import {h, type VNode} from "vue";

import {filterMap} from "../../util";

import {
  friendlyFolderName,
  isBookmark,
  isFolder,
  type Bookmark,
  type Folder,
  type Model,
} from "../../model/bookmarks";

export type ExportFolder = {
  id: string;
  title: string;
  bookmarks: ExportBookmark[];
  folders: ExportFolder[];
};

export type ExportBookmark = {
  id: string;
  title: string;
  url: string;
};

export function exportFolder(m: Model, f: Folder): ExportFolder {
  return {
    id: f.id,
    title: friendlyFolderName(f.title),
    bookmarks: filterMap(f.children, c => (isBookmark(c) ? c : undefined)).map(
      exportBookmark,
    ),
    folders: filterMap(f.children, c => (isFolder(c) ? c : undefined)).map(f =>
      exportFolder(m, f),
    ),
  };
}

export function exportBookmark(bm: Bookmark): ExportBookmark {
  return {id: bm.id, title: bm.title, url: bm.url};
}

export function br(): VNode {
  return h("div", {}, [h("br")]);
}
