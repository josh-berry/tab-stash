import {expect} from "chai";

import * as events from "../mock/events.js";

import {filterMap} from "../util/index.js";

import * as BM from "../model/bookmarks.js";
import {
  B,
  make_bookmarks,
  make_tabs,
  STASH_ROOT_NAME,
  type BookmarkFixture,
  type TabFixture,
} from "../model/fixtures.testlib.js";
import * as T from "../model/tabs.js";

import {recvDragData, sendDragData} from "./dnd-proto.js";

class TestDT implements DataTransfer {
  dropEffect: "link" | "none" | "copy" | "move" = "move";
  effectAllowed:
    | "link"
    | "none"
    | "copy"
    | "move"
    | "copyLink"
    | "copyMove"
    | "linkMove"
    | "all"
    | "uninitialized" = "move";

  files: FileList = undefined!;
  items: DataTransferItemList = undefined!;
  types: string[];

  private data: Record<string, string>;

  constructor(data: Record<string, string>) {
    this.data = data;
    this.types = Object.getOwnPropertyNames(data);
  }

  getData(format: string): string {
    /* c8 ignore next -- tests won't ask for data that isn't there */
    return this.data[format] || "";
  }
  setData(format: string, data: string): void {
    this.data[format] = data;
    /* c8 ignore next -- tests never set data multiple times */
    if (!this.types.includes(format)) this.types.push(format);
  }

  /* c8 ignore start -- methods for interface conformance only */
  clearData(format?: string | undefined): void {
    throw new Error("Method not implemented.");
  }

  setDragImage(image: Element, x: number, y: number): void {
    throw new Error("Method not implemented.");
  }
  /* c8 ignore stop */
}

// NOTE: Copied from dnd-proto.ts
const MIXED_TYPE = "application/x-tab-stash-dnd-mixed" as const;
const ONLY_FOLDERS_TYPE = "application/x-tab-stash-dnd-folders" as const;
const ONLY_LEAVES_TYPE = "application/x-tab-stash-dnd-leaves" as const;

const ALLOWED_TYPES = [
  MIXED_TYPE,
  ONLY_FOLDERS_TYPE,
  ONLY_LEAVES_TYPE,
] as const;

describe("stash-list/dnd-proto", () => {
  let model: {bookmarks: BM.Model; tabs: T.Model};
  let tabs: TabFixture["tabs"];
  let bookmarks: BookmarkFixture;

  beforeEach(async () => {
    const window_setup = await make_tabs();
    tabs = window_setup.tabs;

    bookmarks = await make_bookmarks();

    model = {
      bookmarks: await BM.Model.from_browser(STASH_ROOT_NAME),
      tabs: await T.Model.from_browser(),
    };
    await model.bookmarks.loadedSubtree(model.bookmarks.root!);
    expect(events.pendingCount()).to.equal(0);
  });

  function testInvalid(desc: string, i: () => string) {
    for (const type of ALLOWED_TYPES) {
      it(`${desc} [${type}]`, () => {
        const result = recvDragData(new TestDT({[type]: i()}), model);
        expect(result).to.deep.equal([]);
      });
    }
  }

  function testValid(desc: string, items: () => (T.TabID | BM.NodeID)[]) {
    it(desc, () => {
      const i = items();
      const model_items = i.map(id =>
        typeof id === "string" ? model.bookmarks.node(id) : model.tabs.tab(id),
      );

      const valid_model_items = filterMap(model_items, i => i);
      expect(
        model_items.map(i => i?.id),
        `the test references only valid model items`,
      ).to.deep.equal(valid_model_items.map(i => i.id));

      const dt = new TestDT({});
      sendDragData(dt, valid_model_items);

      const result = recvDragData(dt, model);
      expect(result.map(i => "id" in i && i.id)).to.deep.equal(
        valid_model_items.map(i => i.id),
      );
      expect(result).to.deep.equal(valid_model_items);
    });
  }

  testInvalid("ignores nonsense", () => "garbage");
  testInvalid("ignores JSON-shaped nonsense", () => '{"foo":"bar"}');
  testInvalid(
    "ignores values of the wrong type in the provided JSON array",
    () => '[{"foo": "bar"},null,true,false,{},0,"asdf"]',
  );
  testInvalid(
    "ignores invalid IDs in the provided JSON array",
    () =>
      '[{"tab":3.141},{"node":"weird identifier"},{"window":"foo"},{"node":14},{"tab":{"tab":12}}]',
  );

  testValid("finds the requested tabs", () => [
    tabs.left_alice.id,
    tabs.left_charlotte.id,
  ]);
  testValid("finds the requested bookmarks", () => [
    bookmarks.doug_1.id,
    bookmarks.eight.id,
  ]);
  testValid("finds a mix of bookmarks and tabs", () => [
    bookmarks.doug_1.id,
    tabs.left_charlotte.id,
    bookmarks.eight.id,
    tabs.real_patricia.id,
  ]);

  it("copies items when requested", () => {
    const dt = new TestDT({});
    sendDragData(
      dt,
      [bookmarks.doug_1.id, bookmarks.nested_child.id, tabs.right_adam.id].map(
        id =>
          typeof id === "string"
            ? model.bookmarks.node(id)!
            : model.tabs.tab(id)!,
      ),
    );

    dt.dropEffect = "copy";

    const result = recvDragData(dt, model);
    expect(result).to.deep.equal([
      {title: "Doug Duplicate", url: `${B}#doug`},
      {
        title: "Nested Child",
        children: [{title: "1", url: `${B}#nested_child_1`}],
      },
      {title: "", url: `${B}#adam`},
    ]);
  });
});
