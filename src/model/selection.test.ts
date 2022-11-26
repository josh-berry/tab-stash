import {expect} from "chai";
import {computed, nextTick, ref} from "vue";

import type {SelectableModel} from "./selection";
import {Model} from "./selection";

class TestModel implements SelectableModel<string> {
  readonly values = ref([] as string[]);
  readonly selection = ref(new Set<string>());
  readonly selectedCount = computed(() => this.selection.value.size);

  isSelected(s: string): boolean {
    return this.selection.value.has(s);
  }
  async clearSelection(): Promise<void> {
    this.selection.value = new Set();
  }

  async setSelected(
    items: Iterable<string>,
    isSelected: boolean,
  ): Promise<void> {
    if (isSelected) {
      for (const i of items) this.selection.value.add(i);
    } else {
      for (const i of items) this.selection.value.delete(i);
    }
  }

  *selectedItems(): IterableIterator<string> {
    for (const i of this.values.value) if (this.selection.value.has(i)) yield i;
  }

  itemsInRange(start: string, end: string): string[] | null {
    const i = this.values.value.indexOf(start);
    const j = this.values.value.indexOf(end);

    const left = Math.min(i, j);
    const right = Math.max(i, j);

    if (start.length !== end.length) return null;
    return this.values.value.slice(left, right + 1);
  }
}

describe("model/selection", () => {
  let top = new TestModel();
  let bottom = new TestModel();
  let model = new Model([top, bottom]);

  async function expectSelectedItems(topSel: string[], bottomSel: string[]) {
    await nextTick();
    expect(Array.from(top.selectedItems())).to.deep.equal(topSel);
    expect(Array.from(bottom.selectedItems())).to.deep.equal(bottomSel);
    expect(top.selectedCount.value).to.equal(topSel.length);
    expect(bottom.selectedCount.value).to.equal(bottomSel.length);
    expect(model.selectedCount.value).to.equal(
      topSel.length + bottomSel.length,
    );
  }

  beforeEach(() => {
    top = new TestModel();
    top.values.value = ["a", "b", "c", "d", "e", "f"];
    bottom = new TestModel();
    bottom.values.value = ["1", "2", "3", "4", "5", "6", "10", "20", "30"];
    model = new Model([top, bottom]);
  });

  it("counts selected items across models", async () => {
    top.setSelected(["a"], true);
    bottom.setSelected(["1", "2"], true);
    await nextTick();
    expect(top.selectedCount.value).to.equal(1);
    expect(bottom.selectedCount.value).to.equal(2);
    expect(model.selectedCount.value).to.equal(3);
  });

  it("clears all selections", async () => {
    top.setSelected(["a"], true);
    bottom.setSelected(["1", "2"], true);
    await nextTick();
    expect(model.selectedCount.value).to.equal(3);

    await model.clearSelection();
    await expectSelectedItems([], []);
  });

  describe("toggleSelectOne()", () => {
    it("selects a single item when no other items are selected", async () => {
      await model.toggleSelectOne(top, "c");
      await expectSelectedItems(["c"], []);
    });

    it("replaces the selection when selecting an unselected item", async () => {
      top.setSelected(["a"], true);
      bottom.setSelected(["1", "2"], true);
      await expectSelectedItems(["a"], ["1", "2"]);

      await model.toggleSelectOne(top, "c");
      await expectSelectedItems(["c"], []);
    });

    it("replaces the selection when selecting an already-selected item", async () => {
      top.setSelected(["a"], true);
      bottom.setSelected(["1", "2"], true);
      await expectSelectedItems(["a"], ["1", "2"]);

      await model.toggleSelectOne(top, "a");
      await expectSelectedItems(["a"], []);
    });

    it("toggles the selection if the same item is selected again", async () => {
      top.setSelected(["c"], true);
      await expectSelectedItems(["c"], []);

      await model.toggleSelectOne(top, "c");
      await expectSelectedItems([], []);
    });
  });

  describe("toggleSelectScattered()", async () => {
    it("selects a de-selected item", async () => {
      await model.toggleSelectScattered(top, "c");
      await expectSelectedItems(["c"], []);
    });

    it("de-selects a selected item", async () => {
      await model.toggleSelectScattered(top, "c");
      await expectSelectedItems(["c"], []);

      await model.toggleSelectScattered(top, "c");
      await expectSelectedItems([], []);
    });

    it("selects a de-selected item while other items are selected", async () => {
      await model.toggleSelectScattered(top, "c");
      await expectSelectedItems(["c"], []);

      await model.toggleSelectScattered(top, "a");
      await expectSelectedItems(["a", "c"], []);

      await model.toggleSelectScattered(bottom, "2");
      await expectSelectedItems(["a", "c"], ["2"]);
    });

    it("de-selects a selected item while other items are selected", async () => {
      await model.toggleSelectScattered(top, "c");
      await expectSelectedItems(["c"], []);

      await model.toggleSelectScattered(top, "a");
      await expectSelectedItems(["a", "c"], []);

      await model.toggleSelectScattered(bottom, "2");
      await expectSelectedItems(["a", "c"], ["2"]);

      await model.toggleSelectScattered(top, "c");
      await expectSelectedItems(["a"], ["2"]);
    });
  });

  describe("toggleSelectRange()", () => {
    it("selects items in a range", async () => {
      await model.toggleSelectRange(top, "b");
      await model.toggleSelectRange(top, "e");
      await expectSelectedItems(["b", "c", "d", "e"], []);
    });

    it("selects items in a range, in reverse", async () => {
      await model.toggleSelectRange(top, "e");
      await model.toggleSelectRange(top, "b");
      await expectSelectedItems(["b", "c", "d", "e"], []);
    });

    it("adjusts a previously-selected range", async () => {
      await model.toggleSelectScattered(top, "b");
      await model.toggleSelectRange(top, "e");
      await model.toggleSelectRange(top, "d");
      await expectSelectedItems(["b", "c", "d"], []);
    });

    it("adjusts a previously-selected range, in reverse", async () => {
      await model.toggleSelectScattered(top, "e");
      await model.toggleSelectRange(top, "b");
      await model.toggleSelectRange(top, "c");
      await expectSelectedItems(["c", "d", "e"], []);
    });

    it("clears previously-selected items in a range", async () => {
      await model.toggleSelectScattered(top, "a");
      await model.toggleSelectRange(top, "f");
      await model.toggleSelectScattered(top, "c");
      await model.toggleSelectRange(top, "e");
      await expectSelectedItems(["a", "b", "f"], []);
    });

    it("adjusts a previously-cleared range", async () => {
      await model.toggleSelectScattered(top, "a");
      await model.toggleSelectRange(top, "f");
      await model.toggleSelectScattered(top, "c");
      await model.toggleSelectRange(top, "e");
      await model.toggleSelectRange(top, "d");
      await expectSelectedItems(["a", "b", "e", "f"], []);
    });

    it("falls back to scattered selection if the range is invalid", async () => {
      await model.toggleSelectRange(bottom, "1");
      await model.toggleSelectRange(bottom, "10");
      await expectSelectedItems([], ["1", "10"]);
    });

    it("allows range selection in the new range after a disjoint selection", async () => {
      await model.toggleSelectRange(bottom, "1");
      await model.toggleSelectRange(bottom, "10");
      await model.toggleSelectRange(bottom, "30");
      await expectSelectedItems([], ["1", "10", "20", "30"]);
    });
  });
});
