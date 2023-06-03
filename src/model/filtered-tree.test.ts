import {expect} from "chai";
import {nextTick, ref, type Ref} from "vue";

import {
  FilteredTree,
  isFilteredParent,
  type FilteredItem,
  type FilteredParent,
  type FilteredTreeAccessors,
} from "./filtered-tree";
import {pathTo} from "./tree";

import {makeDefaultTree, type TestNode, type TestParent} from "./tree.test";

type Parent = TestParent;
type Child = TestNode;

describe("model/filtered-tree", () => {
  const [root, _parents, nodes] = makeDefaultTree();

  let filteredTree: FilteredTree<Parent, Child>;
  let filteredRoot: FilteredParent<Parent, Child>;
  // istanbul ignore next
  const predicate: Ref<(n: Parent | Child) => boolean> = ref(_ => false);

  const accessors: FilteredTreeAccessors<TestParent, TestNode> = {
    isParent(node): node is TestParent {
      return "children" in node;
    },
    predicate(node): boolean {
      return predicate.value(node);
    },
  };

  function checkFilterInvariants() {
    const visit = (n: FilteredItem<Parent, Child>) => {
      expect(n.isMatching).to.equal(
        predicate.value(n.unfiltered),
        `${n.unfiltered.name}: Predicate does not match`,
      );

      if (!("children" in n)) return;
      let hasMatchingChildren = false;
      let filteredCount = 0;
      for (const c of n.children) {
        visit(c);
        if (c.isMatching || (isFilteredParent(c) && c.hasMatchingChildren)) {
          hasMatchingChildren = true;
        }
        if (!c.isMatching) ++filteredCount;
      }
      expect(n.hasMatchingChildren).to.equal(
        hasMatchingChildren,
        `${n.unfiltered.name}: Incorrect hasMatchingChildren`,
      );
      expect(n.filteredCount).to.equal(
        filteredCount,
        `${n.unfiltered.name}: Incorrect filteredCount`,
      );
    };
    visit(filteredRoot);
  }

  beforeEach(() => {
    // istanbul ignore next
    predicate.value = _ => false;
    filteredTree = new FilteredTree(accessors);
    filteredRoot = filteredTree.wrappedParent(root);
  });

  it("mirrors the structure correctly", () => {
    const checkNode = (t: Parent | Child, f: FilteredItem<Parent, Child>) => {
      expect(f.unfiltered).to.equal(
        t,
        `${t.name}: f.unfiltered returns wrong node`,
      );
      expect(filteredTree.wrappedNode(t)).to.equal(
        f,
        `${t.name}: wrapped node is wrong`,
      );
      if (!("children" in t)) {
        expect("children" in f).to.be.false;
        return;
      }
      // istanbul ignore if -- this is just for type safety
      if (!isFilteredParent(f)) {
        expect(
          "children" in t,
          `${t.name}: ! isFilteredParent(f) => ! children in t`,
        ).to.be.false;
        return;
      }
      expect(t.children.length).to.equal(
        f.children.length,
        `id ${t.name} has differing lengths`,
      );
      const computedChildren = f.children;
      for (let i = 0; i < t.children.length; ++i) {
        checkNode(t.children[i], f.children[i]);
        expect(f.children[i]).to.equal(computedChildren[i]);
      }
    };
    checkNode(root, filteredRoot);
  });

  it("maps positions correctly", () => {
    const n = nodes.c1b;
    const fn = filteredTree.wrappedNode(n);
    const path = pathTo(fn);
    expect(path).to.deep.equal([
      {parent: filteredTree.wrappedNode(nodes.root!), index: 2},
      {parent: filteredTree.wrappedNode(nodes.c!), index: 0},
      {parent: filteredTree.wrappedNode(nodes.c1!), index: 1},
    ]);
  });

  it("reports when nothing matches the filter", () => {
    predicate.value = _ => false;
    for (const v in nodes) {
      const f = filteredTree.wrappedNode(nodes[v]);
      expect(f.isMatching).to.be.false;
    }
    checkFilterInvariants();
  });

  it("reports when everything matches the filter", async () => {
    predicate.value = _ => true;
    await nextTick();

    for (const v in nodes) {
      const f = filteredTree.wrappedNode(nodes[v]);
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
      expect(filteredTree.wrappedNode(nodes[id]!).isMatching).to.equal(val);
    }

    checkFilterInvariants();
  });
});
