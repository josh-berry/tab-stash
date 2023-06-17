import {expect} from "chai";

import * as events from "../mock/events";

import {filterMap} from "../util";

import * as BM from "../model/bookmarks";
import {
  make_bookmarks,
  make_tabs,
  type BookmarkFixture,
  type TabFixture,
} from "../model/fixtures.testlib";
import * as T from "../model/tabs";

import {ACCEPTS, recvDragData, sendDragData} from "./dnd-proto";

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
    // istanbul ignore next -- tests won't ask for data that isn't there
    return this.data[format] || "";
  }
  setData(format: string, data: string): void {
    this.data[format] = data;
    // istanbul ignore next
    if (!this.types.includes(format)) this.types.push(format);
  }

  // istanbul ignore next
  clearData(format?: string | undefined): void {
    throw new Error("Method not implemented.");
  }

  // istanbul ignore next
  setDragImage(image: Element, x: number, y: number): void {
    throw new Error("Method not implemented.");
  }
}

const MT = ACCEPTS[0];

describe("stash-list/dnd-proto", () => {
  let model: {bookmarks: BM.Model; tabs: T.Model};
  let tabs: TabFixture["tabs"];
  let bookmarks: BookmarkFixture;

  beforeEach(async () => {
    const window_setup = await make_tabs();
    tabs = window_setup.tabs;

    bookmarks = await make_bookmarks();

    model = {
      bookmarks: await BM.Model.from_browser(),
      tabs: await T.Model.from_browser(),
    };
    expect(events.pendingCount()).to.equal(0);
  });

  function testInvalid(desc: string, i: () => string) {
    it(desc, () => {
      const result = recvDragData(new TestDT({[MT]: i()}), model);
      expect(result).to.deep.equal([]);
    });
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

      expect(dt.getData(MT)).to.not.equal("");

      const result = recvDragData(dt, model);
      expect(result.map(i => i.id)).to.deep.equal(
        valid_model_items.map(i => i.id),
      );
      expect(result).to.deep.equal(valid_model_items);
    });
  }

  testInvalid("ignores nonsense", () => "garbage");
  testInvalid("ignores JSON-shaped nonsense", () => '{"foo":"bar"}');
  testInvalid(
    "ignores values of the wrong type in the provided JSON array",
    () => '[{"foo": "bar"},null,true,false]',
  );
  testInvalid(
    "ignores invalid IDs in the provided JSON array",
    () => '[3.141,"weird identifier"]',
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
});
