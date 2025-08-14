import {expect} from "chai";
import {nextTick, ref, type Ref} from "vue";

import {TreeFilter} from "./tree-filter.js";

import {
  isTestParent,
  makeDefaultTree,
  type TestNode,
  type TestParent,
} from "./tree.test.js";

type Parent = TestParent;
type Child = TestNode;

describe("model/tree-filter", () => {
  const [root, _parents, nodes] = makeDefaultTree();

  let treeFilter: TreeFilter<Parent, Child>;
  /* c8 ignore next -- default impl is always overridden by tests */
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
        if (!c) continue;
        const ci = treeFilter.info(c);
        visit(c);
        if (ci.isMatching || ci.hasMatchInSubtree) hasMatchInSubtree = true;
        if (!ci.isMatching && !ci.hasMatchInSubtree) ++nonMatchingCount;
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
    /* c8 ignore next -- default impl is always overridden by tests */
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
      ["c2b2", true],
      ["c2b4", false],
      ["e", false],
      ["e2", true],
    ] as const) {
      expect(treeFilter.info(nodes[id]).isMatching).to.equal(val);
    }

    checkFilterInvariants();
  });
});
