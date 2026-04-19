import {expect} from "chai";
import {computed, nextTick} from "vue";

import {TreeSelection} from "./tree-selection.js";
import {makeDefaultTree, type TestNode, TestTree} from "./tree.test.js";

describe("model/tree-selection", () => {
  let [topRoot, topParents, topLeaves] = makeDefaultTree();
  let [bottomRoot, bottomParents, bottomLeaves] = makeDefaultTree();
  let sel = new TreeSelection(
    TestTree,
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
      TestTree,
      computed(() => [topRoot, bottomRoot]),
    );
  });

  it("counts selected items across models", async () => {
    sel.info(topLeaves.a).isSelected = true;
    sel.info(bottomLeaves.a).isSelected = true;
    sel.info(bottomParents.b).isSelected = true;
    await expectSelectedItems([topLeaves.a], [bottomLeaves.a, bottomParents.b]);
  });

  it("clears all selections", async () => {
    sel.info(topLeaves.a).isSelected = true;
    sel.info(bottomLeaves.a).isSelected = true;
    sel.info(bottomParents.b).isSelected = true;
    await nextTick();
    expect(sel.selectedCount.value).to.equal(3);

    sel.clearSelection();
    await expectSelectedItems([], []);
  });

  it("updates counts when nodes move", async () => {
    sel.info(topLeaves.c1a).isSelected = true;
    sel.info(topLeaves.c2b2).isSelected = true;
    sel.info(topLeaves.c2b4).isSelected = true;
    await nextTick();
    expect(sel.info(topParents.c1).selectedCount, "c1 before").to.equal(1);
    expect(sel.info(topParents.c2b).selectedCount, "c2b before").to.equal(2);
    expect(sel.info(topParents.c2).selectedCount, "c2 before").to.equal(2);
    expect(sel.info(topParents.c).selectedCount, "c before").to.equal(3);
    expect(sel.info(topParents.e).selectedCount, "e before").to.equal(0);
    expect(sel.info(topRoot).selectedCount, "root before").to.equal(3);
    await expectSelectedItems(
      [topLeaves.c1a, topLeaves.c2b2, topLeaves.c2b4],
      [],
    );

    TestTree.removeNode(topParents.c2.position!);
    TestTree.insertNode(topParents.c2, {parent: topParents.e, index: 0});
    await nextTick();
    expect(sel.info(topParents.c1).selectedCount, "c1 after").to.equal(1);
    expect(sel.info(topParents.c2b).selectedCount, "c2b after").to.equal(2);
    expect(sel.info(topParents.c2).selectedCount, "c2 after").to.equal(2);
    expect(sel.info(topParents.c).selectedCount, "c after").to.equal(1);
    expect(sel.info(topParents.e).selectedCount, "e after").to.equal(2);
    expect(sel.info(topRoot).selectedCount, "root after").to.equal(3);
    await expectSelectedItems(
      [topLeaves.c1a, topLeaves.c2b2, topLeaves.c2b4],
      [],
    );
  });

  describe("toggleSelectOne()", () => {
    it("selects a single item when no other items are selected", async () => {
      sel.toggleSelectOne(topParents.c);
      await expectSelectedItems([topParents.c], []);
    });

    it("replaces the selection when selecting an unselected item", async () => {
      sel.info(topLeaves.a).isSelected = true;
      sel.info(bottomLeaves.a).isSelected = true;
      sel.info(bottomParents.b).isSelected = true;
      await expectSelectedItems(
        [topLeaves.a],
        [bottomLeaves.a, bottomParents.b],
      );

      sel.toggleSelectOne(topParents.c);
      await expectSelectedItems([topParents.c], []);
    });

    it("replaces the selection when selecting an already-selected item", async () => {
      sel.info(topLeaves.a).isSelected = true;
      sel.info(bottomLeaves.a).isSelected = true;
      sel.info(bottomParents.b).isSelected = true;
      await expectSelectedItems(
        [topLeaves.a],
        [bottomLeaves.a, bottomParents.b],
      );

      sel.toggleSelectOne(topLeaves.a);
      await expectSelectedItems([topLeaves.a], []);
    });

    it("toggles the selection if the same item is selected again", async () => {
      sel.info(topLeaves.a).isSelected = true;
      await expectSelectedItems([topLeaves.a], []);

      sel.toggleSelectOne(topLeaves.a);
      await expectSelectedItems([], []);
    });
  });

  describe("toggleSelectScattered()", async () => {
    it("selects a de-selected item", async () => {
      sel.toggleSelectScattered(topParents.c);
      await expectSelectedItems([topParents.c], []);
    });

    it("de-selects a selected item", async () => {
      sel.toggleSelectScattered(topParents.c);
      await expectSelectedItems([topParents.c], []);

      sel.toggleSelectScattered(topParents.c);
      await expectSelectedItems([], []);
    });

    it("selects a de-selected item while other items are selected", async () => {
      sel.toggleSelectScattered(topParents.c);
      await expectSelectedItems([topParents.c], []);

      sel.toggleSelectScattered(topLeaves.a);
      await expectSelectedItems([topLeaves.a, topParents.c], []);

      sel.toggleSelectScattered(bottomParents.b);
      await expectSelectedItems([topLeaves.a, topParents.c], [bottomParents.b]);
    });

    it("de-selects a selected item while other items are selected", async () => {
      sel.toggleSelectScattered(topParents.c);
      await expectSelectedItems([topParents.c], []);

      sel.toggleSelectScattered(topLeaves.a);
      await expectSelectedItems([topLeaves.a, topParents.c], []);

      sel.toggleSelectScattered(bottomParents.b);
      await expectSelectedItems([topLeaves.a, topParents.c], [bottomParents.b]);

      sel.toggleSelectScattered(topParents.c);
      await expectSelectedItems([topLeaves.a], [bottomParents.b]);
    });
  });

  describe("toggleSelectRange()", () => {
    it("selects items in a range", async () => {
      sel.toggleSelectRange(topParents.b);
      sel.toggleSelectRange(topParents.e);
      await expectSelectedItems(
        [topParents.b, topParents.c, topLeaves.d, topParents.e],
        [],
      );
    });

    it("selects items in a range, in reverse", async () => {
      sel.toggleSelectRange(topParents.e);
      sel.toggleSelectRange(topParents.b);
      await expectSelectedItems(
        [topParents.b, topParents.c, topLeaves.d, topParents.e],
        [],
      );
    });

    it("adjusts a previously-selected range", async () => {
      sel.toggleSelectScattered(topParents.b);
      sel.toggleSelectRange(topParents.e);
      sel.toggleSelectRange(topLeaves.d);
      await expectSelectedItems([topParents.b, topParents.c, topLeaves.d], []);
    });

    it("adjusts a previously-selected range, in reverse", async () => {
      sel.toggleSelectScattered(topParents.e);
      sel.toggleSelectRange(topParents.b);
      sel.toggleSelectRange(topParents.c);
      await expectSelectedItems([topParents.c, topLeaves.d, topParents.e], []);
    });

    it("clears previously-selected items in a range", async () => {
      sel.toggleSelectScattered(topLeaves.a);
      sel.toggleSelectRange(topLeaves.f);
      sel.toggleSelectScattered(topParents.c);
      sel.toggleSelectRange(topParents.e);
      await expectSelectedItems([topLeaves.a, topParents.b, topLeaves.f], []);
    });

    it("adjusts a previously-cleared range", async () => {
      sel.toggleSelectScattered(topLeaves.a);
      sel.toggleSelectRange(topLeaves.f);
      sel.toggleSelectScattered(topParents.c);
      sel.toggleSelectRange(topParents.e);
      sel.toggleSelectRange(topLeaves.d);
      await expectSelectedItems(
        [topLeaves.a, topParents.b, topParents.e, topLeaves.f],
        [],
      );
    });

    it("falls back to scattered selection if the range is invalid", async () => {
      sel.toggleSelectRange(bottomParents.c);
      sel.toggleSelectRange(bottomLeaves.c1a);
      await expectSelectedItems([], [bottomParents.c, bottomLeaves.c1a]);
    });

    it("allows range selection in the new range after a disjoint selection", async () => {
      sel.toggleSelectRange(bottomParents.c);
      sel.toggleSelectRange(bottomLeaves.c1a);
      sel.toggleSelectRange(bottomLeaves.c1c);
      await expectSelectedItems(
        [],
        [bottomParents.c, bottomLeaves.c1a, bottomLeaves.c1b, bottomLeaves.c1c],
      );
    });
  });
});
