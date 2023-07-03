import {expect} from "chai";
import {nextTick, ref, type Ref} from "vue";

import {TreeFilter} from "./tree-filter";

import {
  isTestParent,
  makeDefaultTree,
  type TestNode,
  type TestParent,
} from "./tree.test";

type Parent = TestParent;
type Child = TestNode;

describe("model/tree-filter", () => {
  const [root, _parents, nodes] = makeDefaultTree();

  let treeFilter: TreeFilter<Parent, Child>;
  // istanbul ignore next
  const predicate: Ref<(n: Parent | Child) => boolean> = ref(_ => false);

  function checkFilterInvariants() {
    const visit = (n: Parent | Child) => {
      const i = treeFilter.info(n);
      expect(i.isMatching).to.equal(
        predicate.value(n),
        `${n.name}: Predicate does not match`,
      );

      if (!("children" in n)) return;
      let hasMatchInSubtree = false;
      let nonMatchingCount = 0;
      for (const c of n.children) {
        const ci = treeFilter.info(c);
        visit(c);
        if (ci.isMatching || ci.hasMatchInSubtree) hasMatchInSubtree = true;
        if (!ci.hasMatchInSubtree) ++nonMatchingCount;
      }
      expect(i.hasMatchInSubtree).to.equal(
        hasMatchInSubtree,
        `${n.name}: Incorrect hasMatchingChildren`,
      );
      expect(i.nonMatchingCount).to.equal(
        nonMatchingCount,
        `${n.name}: Incorrect filteredCount`,
      );
    };
    visit(root);
  }

  beforeEach(() => {
    // istanbul ignore next
    predicate.value = _ => false;
    treeFilter = new TreeFilter(isTestParent, predicate);
  });

  it("reports when nothing matches the filter", () => {
    predicate.value = _ => false;
    for (const v in nodes) {
      const f = treeFilter.info(nodes[v]);
      expect(f.isMatching).to.be.false;
    }
    checkFilterInvariants();
  });

  it("reports when everything matches the filter", async () => {
    predicate.value = _ => true;
    await nextTick();

    for (const v in nodes) {
      const f = treeFilter.info(nodes[v]);
      expect(f.isMatching).to.be.true;
    }
    checkFilterInvariants();
  });

  it("reports when some things match the filter", async () => {
    predicate.value = n => n.name.endsWith("2");
    await nextTick();

    for (const [id, val] of [
      ["a", false],
      ["b2", true],
      ["c2", true],
      ["c2b1", false],
      ["c2b2", true],
      ["e", false],
      ["e2", true],
    ] as const) {
      expect(treeFilter.info(nodes[id]!).isMatching).to.equal(val);
    }

    checkFilterInvariants();
  });
});
