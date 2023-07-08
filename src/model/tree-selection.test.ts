import {expect} from "chai";
import {computed, nextTick} from "vue";

import {setPosition} from "./tree";
import {TreeSelection} from "./tree-selection";
import {isTestParent, makeDefaultTree, type TestNode} from "./tree.test";

describe("model/tree-selection", () => {
  let [topRoot, topParents, topNodes] = makeDefaultTree();
  let [bottomRoot, _bottomParents, bottomNodes] = makeDefaultTree();
  let sel = new TreeSelection(
    isTestParent,
    computed(() => [topRoot, bottomRoot]),
  );

  async function expectSelectedItems(
    topSel: TestNode[],
    bottomSel: TestNode[],
  ) {
    expect(Array.from(sel.selectedItems())).to.deep.equal([
      ...topSel,
      ...bottomSel,
    ]);
    await nextTick();
    expect(sel.info(topRoot).selectedCount).to.equal(topSel.length);
    expect(sel.info(bottomRoot).selectedCount).to.equal(bottomSel.length);
    expect(sel.info(topRoot).hasSelectionInSubtree).to.equal(
      topSel.length !== 0,
    );
    expect(sel.info(bottomRoot).hasSelectionInSubtree).to.equal(
      bottomSel.length !== 0,
    );
    expect(sel.selectedCount.value).to.equal(topSel.length + bottomSel.length);
  }

  beforeEach(() => {
    sel = new TreeSelection(
      isTestParent,
      computed(() => [topRoot, bottomRoot]),
    );
  });

  it("counts selected items across models", async () => {
    sel.info(topNodes.a).isSelected = true;
    sel.info(bottomNodes.a).isSelected = true;
    sel.info(bottomNodes.b).isSelected = true;
    await expectSelectedItems([topNodes.a], [bottomNodes.a, bottomNodes.b]);
  });

  it("clears all selections", async () => {
    sel.info(topNodes.a).isSelected = true;
    sel.info(bottomNodes.a).isSelected = true;
    sel.info(bottomNodes.b).isSelected = true;
    await nextTick();
    expect(sel.selectedCount.value).to.equal(3);

    sel.clearSelection();
    await expectSelectedItems([], []);
  });

  it("updates counts when nodes move", async () => {
    sel.info(topNodes.c1a).isSelected = true;
    sel.info(topNodes.c2b1).isSelected = true;
    sel.info(topNodes.c2b2).isSelected = true;
    await nextTick();
    expect(sel.info(topNodes.c1).selectedCount, "c1 before").to.equal(1);
    expect(sel.info(topNodes.c2b).selectedCount, "c2b before").to.equal(2);
    expect(sel.info(topNodes.c2).selectedCount, "c2 before").to.equal(2);
    expect(sel.info(topNodes.c).selectedCount, "c before").to.equal(3);
    expect(sel.info(topNodes.e).selectedCount, "e before").to.equal(0);
    expect(sel.info(topNodes.root).selectedCount, "root before").to.equal(3);
    await expectSelectedItems([topNodes.c1a, topNodes.c2b1, topNodes.c2b2], []);

    setPosition(topNodes.c2, {parent: topParents.e, index: 0});
    await nextTick();
    expect(sel.info(topNodes.c1).selectedCount, "c1 after").to.equal(1);
    expect(sel.info(topNodes.c2b).selectedCount, "c2b after").to.equal(2);
    expect(sel.info(topNodes.c2).selectedCount, "c2 after").to.equal(2);
    expect(sel.info(topNodes.c).selectedCount, "c after").to.equal(1);
    expect(sel.info(topNodes.e).selectedCount, "e after").to.equal(2);
    expect(sel.info(topNodes.root).selectedCount, "root after").to.equal(3);
    await expectSelectedItems([topNodes.c1a, topNodes.c2b1, topNodes.c2b2], []);
  });

  describe("toggleSelectOne()", () => {
    it("selects a single item when no other items are selected", async () => {
      sel.toggleSelectOne(topNodes.c);
      await expectSelectedItems([topNodes.c], []);
    });

    it("replaces the selection when selecting an unselected item", async () => {
      sel.info(topNodes.a).isSelected = true;
      sel.info(bottomNodes.a).isSelected = true;
      sel.info(bottomNodes.b).isSelected = true;
      await expectSelectedItems([topNodes.a], [bottomNodes.a, bottomNodes.b]);

      sel.toggleSelectOne(topNodes.c);
      await expectSelectedItems([topNodes.c], []);
    });

    it("replaces the selection when selecting an already-selected item", async () => {
      sel.info(topNodes.a).isSelected = true;
      sel.info(bottomNodes.a).isSelected = true;
      sel.info(bottomNodes.b).isSelected = true;
      await expectSelectedItems([topNodes.a], [bottomNodes.a, bottomNodes.b]);

      sel.toggleSelectOne(topNodes.a);
      await expectSelectedItems([topNodes.a], []);
    });

    it("toggles the selection if the same item is selected again", async () => {
      sel.info(topNodes.a).isSelected = true;
      await expectSelectedItems([topNodes.a], []);

      sel.toggleSelectOne(topNodes.a);
      await expectSelectedItems([], []);
    });
  });

  describe("toggleSelectScattered()", async () => {
    it("selects a de-selected item", async () => {
      sel.toggleSelectScattered(topNodes.c);
      await expectSelectedItems([topNodes.c], []);
    });

    it("de-selects a selected item", async () => {
      sel.toggleSelectScattered(topNodes.c);
      await expectSelectedItems([topNodes.c], []);

      sel.toggleSelectScattered(topNodes.c);
      await expectSelectedItems([], []);
    });

    it("selects a de-selected item while other items are selected", async () => {
      sel.toggleSelectScattered(topNodes.c);
      await expectSelectedItems([topNodes.c], []);

      sel.toggleSelectScattered(topNodes.a);
      await expectSelectedItems([topNodes.a, topNodes.c], []);

      sel.toggleSelectScattered(bottomNodes.b);
      await expectSelectedItems([topNodes.a, topNodes.c], [bottomNodes.b]);
    });

    it("de-selects a selected item while other items are selected", async () => {
      sel.toggleSelectScattered(topNodes.c);
      await expectSelectedItems([topNodes.c], []);

      sel.toggleSelectScattered(topNodes.a);
      await expectSelectedItems([topNodes.a, topNodes.c], []);

      sel.toggleSelectScattered(bottomNodes.b);
      await expectSelectedItems([topNodes.a, topNodes.c], [bottomNodes.b]);

      sel.toggleSelectScattered(topNodes.c);
      await expectSelectedItems([topNodes.a], [bottomNodes.b]);
    });
  });

  describe("toggleSelectRange()", () => {
    it("selects items in a range", async () => {
      sel.toggleSelectRange(topNodes.b);
      sel.toggleSelectRange(topNodes.e);
      await expectSelectedItems(
        [topNodes.b, topNodes.c, topNodes.d, topNodes.e],
        [],
      );
    });

    it("selects items in a range, in reverse", async () => {
      sel.toggleSelectRange(topNodes.e);
      sel.toggleSelectRange(topNodes.b);
      await expectSelectedItems(
        [topNodes.b, topNodes.c, topNodes.d, topNodes.e],
        [],
      );
    });

    it("adjusts a previously-selected range", async () => {
      sel.toggleSelectScattered(topNodes.b);
      sel.toggleSelectRange(topNodes.e);
      sel.toggleSelectRange(topNodes.d);
      await expectSelectedItems([topNodes.b, topNodes.c, topNodes.d], []);
    });

    it("adjusts a previously-selected range, in reverse", async () => {
      sel.toggleSelectScattered(topNodes.e);
      sel.toggleSelectRange(topNodes.b);
      sel.toggleSelectRange(topNodes.c);
      await expectSelectedItems([topNodes.c, topNodes.d, topNodes.e], []);
    });

    it("clears previously-selected items in a range", async () => {
      sel.toggleSelectScattered(topNodes.a);
      sel.toggleSelectRange(topNodes.f);
      sel.toggleSelectScattered(topNodes.c);
      sel.toggleSelectRange(topNodes.e);
      await expectSelectedItems([topNodes.a, topNodes.b, topNodes.f], []);
    });

    it("adjusts a previously-cleared range", async () => {
      sel.toggleSelectScattered(topNodes.a);
      sel.toggleSelectRange(topNodes.f);
      sel.toggleSelectScattered(topNodes.c);
      sel.toggleSelectRange(topNodes.e);
      sel.toggleSelectRange(topNodes.d);
      await expectSelectedItems(
        [topNodes.a, topNodes.b, topNodes.e, topNodes.f],
        [],
      );
    });

    it("falls back to scattered selection if the range is invalid", async () => {
      sel.toggleSelectRange(bottomNodes.c);
      sel.toggleSelectRange(bottomNodes.c1a);
      await expectSelectedItems([], [bottomNodes.c, bottomNodes.c1a]);
    });

    it("allows range selection in the new range after a disjoint selection", async () => {
      sel.toggleSelectRange(bottomNodes.c);
      sel.toggleSelectRange(bottomNodes.c1a);
      sel.toggleSelectRange(bottomNodes.c1c);
      await expectSelectedItems(
        [],
        [bottomNodes.c, bottomNodes.c1a, bottomNodes.c1b, bottomNodes.c1c],
      );
    });
  });
});
