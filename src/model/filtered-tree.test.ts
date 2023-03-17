import {expect} from "chai";
import {nextTick, ref, type Ref} from "vue";

import {
  FilteredTree,
  type FilteredItem,
  type FilteredParent,
} from "./filtered-tree";
import {pathTo, type Position, type Tree} from "./tree";

class TestTree implements Tree<Parent, Child> {
  readonly root: Parent;
  readonly by_id = new Map<string, Parent | Child>();

  constructor() {
    this.root = {
      id: "root",
      children: [
        {id: "a"},
        {id: "b", children: [{id: "b1"}, {id: "b2"}]},
        {
          id: "c",
          children: [
            {id: "c1", children: [{id: "c1a"}, {id: "c1b"}, {id: "c1c"}]},
            {
              id: "c2",
              children: [
                {id: "c2a"},
                {
                  id: "c2b",
                  children: [{id: "c2b1"}, {id: "c2b2"}, {id: "c2b3"}],
                },
              ],
            },
          ],
        },
        {id: "d"},
        {id: "e", children: [{id: "e1"}, {id: "e2"}]},
      ],
    };

    const setup = (n: Parent | Child) => {
      this.by_id.set(n.id, n);
      if ("children" in n) {
        for (const c of n.children) {
          c.parent = n;
          setup(c);
        }
      }
    };
    setup(this.root);
  }

  isParent(node: Parent | Child): node is Parent {
    return "children" in node;
  }

  positionOf(node: Parent | Child): Position<Parent> | undefined {
    if (!node.parent) return undefined;
    return {parent: node.parent, index: node.parent.children.indexOf(node)};
  }

  childrenOf(parent: Parent): readonly (Parent | Child)[] {
    return parent.children;
  }
}

type Parent = {
  readonly id: string;
  parent?: Parent;
  readonly children: (Parent | Child)[];
};
type Child = {readonly id: string; parent?: Parent};

describe("model/filtered-tree", () => {
  const tree = new TestTree();
  let filteredTree: FilteredTree<Parent, Child>;
  let filteredRoot: FilteredParent<Parent, Child>;
  // istanbul ignore next
  const predicate: Ref<(n: Parent | Child) => boolean> = ref(_ => false);

  function checkFilterInvariants() {
    const visit = (n: FilteredItem<Parent, Child>) => {
      expect(n.isMatching.value).to.equal(
        predicate.value(n.unfiltered),
        `${n.unfiltered.id}: Predicate does not match`,
      );

      if (!("children" in n)) return;
      let hasMatchingChildren = false;
      let filteredCount = 0;
      for (const c of n.children.value) {
        visit(c);
        if (
          c.isMatching.value ||
          (filteredTree.isParent(c) && c.hasMatchingChildren.value)
        )
          hasMatchingChildren = true;
        if (!c.isMatching.value) ++filteredCount;
      }
      expect(n.hasMatchingChildren.value).to.equal(
        hasMatchingChildren,
        `${n.unfiltered.id}: Incorrect hasMatchingChildren`,
      );
      expect(n.filteredCount.value).to.equal(
        filteredCount,
        `${n.unfiltered.id}: Incorrect filteredCount`,
      );
    };
    visit(filteredRoot);
  }

  beforeEach(() => {
    // istanbul ignore next
    predicate.value = _ => false;
    filteredTree = new FilteredTree(tree, n => predicate.value(n));
    filteredRoot = filteredTree.wrappedParent(tree.root);
  });

  it("mirrors the structure correctly", () => {
    const checkNode = (t: Parent | Child, f: FilteredItem<Parent, Child>) => {
      expect(f.unfiltered).to.equal(
        t,
        `${t.id}: f.unfiltered returns wrong node`,
      );
      expect(filteredTree.wrappedNode(t)).to.equal(
        f,
        `${t.id}: wrapped node is wrong`,
      );
      if (!tree.isParent(t)) {
        expect("children" in f).to.be.false;
        return;
      }
      // istanbul ignore if -- this is just for type safety
      if (!filteredTree.isParent(f)) {
        expect("children" in t).to.be.false;
        return;
      }
      expect(t.children.length).to.equal(
        f.children.value.length,
        `id ${t.id} has differing lengths`,
      );
      const computedChildren = filteredTree.childrenOf(f);
      for (let i = 0; i < t.children.length; ++i) {
        checkNode(t.children[i], f.children.value[i]);
        expect(f.children.value[i]).to.equal(computedChildren[i]);
      }
    };
    checkNode(tree.root, filteredRoot);
  });

  it("maps positions correctly", () => {
    const n = tree.by_id.get("c1b")!;
    const fn = filteredTree.wrappedNode(n);
    const path = pathTo(filteredTree, fn);
    expect(path).to.deep.equal([
      {parent: filteredTree.wrappedNode(tree.by_id.get("root")!), index: 2},
      {parent: filteredTree.wrappedNode(tree.by_id.get("c")!), index: 0},
      {parent: filteredTree.wrappedNode(tree.by_id.get("c1")!), index: 1},
    ]);
  });

  it("reports when nothing matches the filter", () => {
    predicate.value = _ => false;
    for (const v of tree.by_id.values()) {
      const f = filteredTree.wrappedNode(v);
      expect(f.isMatching.value).to.be.false;
    }
    checkFilterInvariants();
  });

  it("reports when everything matches the filter", async () => {
    predicate.value = _ => true;
    await nextTick();

    for (const v of tree.by_id.values()) {
      const f = filteredTree.wrappedNode(v);
      expect(f.isMatching.value).to.be.true;
    }
    checkFilterInvariants();
  });

  it("reports when some things match the filter", async () => {
    predicate.value = n => n.id.endsWith("2");
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
      expect(
        filteredTree.wrappedNode(tree.by_id.get(id)!).isMatching.value,
      ).to.equal(val);
    }

    checkFilterInvariants();
  });
});
