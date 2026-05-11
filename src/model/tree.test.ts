import {expect} from "chai";

import {reactive} from "vue";
import {Tree, type TreePosition} from "./tree.js";

export interface TestRoot {
  name: string;
  isLoaded: boolean;
  children: (TestParent | TestLeaf | undefined)[];
}

export interface TestParent {
  name: string;
  position: TestPosition | undefined;
  isLoaded: boolean;
  children: (TestParent | TestLeaf | undefined)[];
}

export interface TestLeaf {
  name: string;
  position: TestPosition | undefined;
}

export type TestNode = TestRoot | TestParent | TestLeaf;
export type TestPosition = TreePosition<TestRoot | TestParent>;

export const TestTree = new (class extends Tree<
  TestRoot,
  TestParent,
  TestLeaf
> {
  isRootType(node: TestNode): node is TestRoot {
    return "children" in node && !("position" in node);
  }
  isLeafType(node: TestNode): node is TestLeaf {
    return "position" in node && !("children" in node);
  }
  isLoaded(parent: TestRoot | TestParent): boolean {
    return parent.isLoaded;
  }
  positionOf(node: TestParent | TestLeaf): TestPosition | undefined {
    return node.position;
  }
  childrenOf(parent: TestParent): (TestParent | TestLeaf | undefined)[] {
    return parent.children;
  }
  protected setPosition(
    node: TestParent | TestLeaf,
    position: TestPosition | undefined,
  ): void {
    node.position = position;
  }
})();

export type TestNodeDef = string | TestParentDef;
export type TestParentDef = {
  readonly name: string;
  readonly children: readonly (TestNodeDef | undefined)[];
  readonly isLoaded?: boolean;
};

type ParentNamesOf<D> = D extends TestParentDef
  ? D["name"] | ParentNamesOf<D["children"][number]>
  : never;

type LeafNamesOf<D> = D extends TestParentDef
  ? Extract<D["children"][number], string> | LeafNamesOf<D["children"][number]>
  : never;

export function makeTree(
  rootDef: TestParentDef,
): [TestRoot, Record<string, TestParent>, Record<string, TestLeaf>] {
  const parents: Record<string, TestParent> = {};
  const leaves: Record<string, TestLeaf> = {};

  function inner(def: TestNodeDef): TestParent | TestLeaf {
    if (typeof def === "string") {
      const n = reactive({name: def, position: undefined});
      leaves[def] = n;
      return n;
    }

    const n: TestParent = reactive({
      name: def.name,
      position: undefined,
      children: [],
      isLoaded: def.isLoaded ?? false,
    });

    let i = 0;
    for (const d of def.children) {
      if (d) {
        const c = inner(d);
        c.position = reactive({parent: n, index: i});
        n.children.push(c);
      } else {
        n.children.push(undefined);
      }
      ++i;
    }

    parents[def.name] = n;
    return n;
  }

  const root = reactive({
    name: rootDef.name,
    isLoaded: rootDef.isLoaded ?? false,
    children: rootDef.children.map(d => (d ? inner(d) : undefined)),
  });

  for (let i = 0; i < root.children.length; ++i) {
    const c = root.children[i];
    if (c) c.position = reactive({parent: root, index: i});
  }

  return [root, parents, leaves];
}

export function checkTree(root: TestRoot) {
  function checkNode(n: TestNode) {
    if (!TestTree.isLeafType(n)) {
      let idx = 0;
      for (const c of n.children) {
        if (c) {
          const pos = c.position!;
          expect(pos, `${c.name} has a position`).to.not.be.undefined;
          expect(
            pos.parent,
            `${c.name}'s position parent is ${n.name}`,
          ).to.equal(n);
          expect(pos.index, `${c.name}'s position index is ${idx}`).to.equal(
            idx,
          );
          checkNode(c);
        }
        ++idx;
      }
    }

    if (!("position" in n) || !n.position) return;

    const parent = n.position.parent;
    const idx = n.position.index;
    expect(
      parent.children[idx],
      `${n.name} is present at index ${idx} in parent ${parent.name}`,
    ).to.equal(n);
  }

  checkNode(root);
}

const DEFAULT_TREE = {
  name: "root",
  children: [
    "a",
    {name: "b", children: ["b1", "b2"], isLoaded: true},
    {
      name: "c",
      children: [
        {name: "c1", children: ["c1a", "c1b", "c1c"], isLoaded: false},
        {
          name: "c2",
          children: [
            "c2a",
            {
              name: "c2b",
              children: [undefined, "c2b2", undefined, "c2b4"],
              isLoaded: false,
            },
          ],
        },
      ],
    },
    "d",
    {name: "e", children: ["e1", "e2"]},
    "f",
  ],
  isLoaded: true,
} as const;

export const makeDefaultTree = (): [
  TestRoot,
  Record<ParentNamesOf<(typeof DEFAULT_TREE)["children"][number]>, TestParent>,
  Record<LeafNamesOf<typeof DEFAULT_TREE>, TestLeaf>,
] => makeTree(DEFAULT_TREE);

describe("model/tree", () => {
  let [root, parents, leaves] = makeDefaultTree();

  beforeEach(() => {
    [root, parents, leaves] = makeDefaultTree();
    checkTree(root);
  });

  describe("isChildInParent()", () => {
    it("nodes contain themselves", () =>
      expect(TestTree.isChildInParent(root, root)).to.be.true);
    it("nodes contain their direct children", () =>
      expect(TestTree.isChildInParent(leaves.a, root)).to.be.true);
    it("nodes contain their indirect children", () =>
      expect(TestTree.isChildInParent(leaves.c2b2, parents.c)).to.be.true);
    it("nodes do not contain their siblings", () =>
      expect(TestTree.isChildInParent(parents.e, parents.c)).to.be.false);
    it("nodes do not contain their parent siblings", () =>
      expect(TestTree.isChildInParent(parents.c1, parents.e)).to.be.false);
    it("nodes do not contain children of their siblings", () =>
      expect(TestTree.isChildInParent(parents.e, parents.c1)).to.be.false);
    it("nodes do not contain their children", () =>
      expect(TestTree.isChildInParent(parents.c, parents.c2)).to.be.false);
    it("nodes do not contain their indirect children", () =>
      expect(TestTree.isChildInParent(parents.c, parents.c2b)).to.be.false);
  });

  describe("pathTo()", () => {
    it("reports an empty path for the root", () =>
      expect(TestTree.pathTo(root)).to.deep.equal([]));
    it("reports the path to an immediate child of the root", () =>
      expect(TestTree.pathTo(parents.b)).to.deep.equal([parents.b.position]));
    it("reports the path to an indirect descendant of the root", () =>
      expect(TestTree.pathTo(leaves.c2b4)).to.deep.equal([
        parents.c.position,
        parents.c2.position,
        parents.c2b.position,
        leaves.c2b4.position,
      ]));
  });

  describe("placeNode()", () => {
    function test(
      notes: string,
      name: keyof typeof parents,
      index: number,
      expectedChildren: (
        | keyof typeof leaves
        | keyof typeof parents
        | "new"
        | undefined
      )[],
      options?: {fails?: boolean},
    ) {
      it(`${notes}: ${options?.fails ? "fails" : "succeeds"} at ${name}[${index}]`, () => {
        const n: TestLeaf = reactive({name: "new", position: undefined});
        const p = reactive({parent: parents[name], index});
        if (!options?.fails) {
          TestTree.placeNode(n, p);
          expect(
            p.parent.children[p.index],
            `parent.children has node`,
          ).to.equal(n);
          expect(n.position, `node.position is set`).to.equal(p);
        } else {
          expect(() => TestTree.placeNode(n, p)).to.throw(Error);
          expect(n.position, `node.position is not set`).to.be.undefined;
        }
        expect(
          p.parent.children.map(c => c?.name),
          `children are as expected`,
        ).to.deep.equal(expectedChildren);
        checkTree(root);
      });
    }

    it("crashes on node that's already in a tree", () => {
      expect(() =>
        TestTree.placeNode(parents.c2, {parent: parents.c, index: 0}),
      ).to.throw(Error);
      checkTree(root);
    });

    test("too-small index", "c1", -1, ["c1a", "c1b", "c1c"], {fails: true});
    test("replacing existing", "c1", 0, ["c1a", "c1b", "c1c"], {fails: true});
    test("beginning of unloaded", "c2b", 0, ["new", "c2b2", undefined, "c2b4"]);
    test("middle of unloaded", "c2b", 2, [undefined, "c2b2", "new", "c2b4"]);
    test("end of unloaded", "c2b", 4, [
      undefined,
      "c2b2",
      undefined,
      "c2b4",
      "new",
    ]);
    test("past end of unloaded", "c1", 4, [
      "c1a",
      "c1b",
      "c1c",
      undefined,
      "new",
    ]);
    test("end of loaded", "b", 2, ["b1", "b2", "new"]);
    test("past end of loaded", "b", 3, ["b1", "b2"], {fails: true});
  });

  describe("insertNode()", () => {
    function test(
      notes: string,
      name: keyof typeof parents,
      index: number,
      expectedChildren: (
        | keyof typeof leaves
        | keyof typeof parents
        | "new"
        | undefined
      )[],
      options?: {fails?: boolean},
    ) {
      it(`${notes}: ${options?.fails ? "fails" : "succeeds"} at ${name}[${index}]`, () => {
        const n: TestLeaf = reactive({name: "new", position: undefined});
        const p = reactive({parent: parents[name], index});
        if (!options?.fails) {
          TestTree.insertNode(n, p);
          expect(p.parent.children[p.index]).to.equal(n);
          expect(n.position).to.deep.equal(p);
        } else {
          expect(() => TestTree.insertNode(n, p)).to.throw(Error);
          expect(n.position).to.be.undefined;
        }
        expect(p.parent.children.map(c => c?.name)).to.deep.equal(
          expectedChildren,
        );
        checkTree(root);
      });
    }

    it("crashes on node that's already in a tree", () => {
      expect(() =>
        TestTree.insertNode(parents.c2, {parent: parents.c, index: 0}),
      ).to.throw(Error);
      checkTree(root);
    });

    test("too-small index", "c1", -1, ["c1a", "c1b", "c1c"], {fails: true});
    test("beginning of unloaded", "c1", 0, ["new", "c1a", "c1b", "c1c"]);
    test("middle of unloaded", "c1", 2, ["c1a", "c1b", "new", "c1c"]);
    test("end of unloaded", "c1", 3, ["c1a", "c1b", "c1c", "new"]);
    test("past end of unloaded", "c1", 4, [
      "c1a",
      "c1b",
      "c1c",
      undefined,
      "new",
    ]);
    test("past end of loaded", "b", 4, ["b1", "b2"], {fails: true});
    test("on empty slot", "c2b", 2, [
      undefined,
      "c2b2",
      "new",
      undefined,
      "c2b4",
    ]);
  });

  describe("removeNode()", () => {
    function test(
      notes: string,
      name: keyof typeof parents,
      index: number,
      expectedChildren: (
        | keyof typeof leaves
        | keyof typeof parents
        | undefined
      )[],
      options?: {fails?: boolean},
    ) {
      it(`${notes}: ${options?.fails ? "fails" : "succeeds"} at ${name}[${index}]`, () => {
        const p = reactive({parent: parents[name], index});
        const n = parents[name].children[index];
        if (!options?.fails) {
          TestTree.removeNode(p);
          expect(n?.position).to.be.undefined;
          expect(p.parent.children[p.index]).not.to.equal(n);
        } else {
          expect(() => TestTree.removeNode(p)).to.throw(Error);
          expect(n?.position).not.to.be.undefined;
        }
        expect(p.parent.children.map(c => c?.name)).to.deep.equal(
          expectedChildren,
        );
        checkTree(root);
      });
    }

    test("remove node from beginning", "c1", 0, ["c1b", "c1c"]);
    test("remove undefined from beginning", "c2b", 0, [
      "c2b2",
      undefined,
      "c2b4",
    ]);
    test("remove node from middle", "c1", 1, ["c1a", "c1c"]);
    test("remove undefined from middle", "c2b", 2, [undefined, "c2b2", "c2b4"]);
    test("remove node from end", "c1", 2, ["c1a", "c1b"]);
  });

  describe("splitParentAtIndexIntoNode()", () => {
    let newParent: TestParent;
    beforeEach(() => {
      newParent = reactive({
        name: "new",
        children: [],
        position: undefined,
        isLoaded: true,
      });
    });

    it("splits at the beginning of a parent", () => {
      TestTree.splitParentAtIndexIntoNode(parents.c1, 0, newParent);
      expect(parents.c1.children.map(c => c?.name)).to.deep.equal([]);
      expect(newParent.children.map(c => c?.name)).to.deep.equal([
        "c1a",
        "c1b",
        "c1c",
      ]);
      expect(newParent.position!.parent.name).to.equal("c");
      expect(newParent.position!.index).to.equal(1);
      checkTree(root);
    });

    it("splits in the middle of a parent", () => {
      TestTree.splitParentAtIndexIntoNode(parents.c1, 1, newParent);
      expect(parents.c1.children.map(c => c?.name)).to.deep.equal(["c1a"]);
      expect(newParent.children.map(c => c?.name)).to.deep.equal([
        "c1b",
        "c1c",
      ]);
      expect(newParent.position!.parent.name).to.equal("c");
      expect(newParent.position!.index).to.equal(1);
      checkTree(root);
    });

    it("splits at the end of a parent", () => {
      TestTree.splitParentAtIndexIntoNode(parents.c1, 3, newParent);
      expect(parents.c1.children.map(c => c?.name)).to.deep.equal([
        "c1a",
        "c1b",
        "c1c",
      ]);
      expect(newParent.children.map(c => c?.name)).to.deep.equal([]);
      expect(newParent.position!.parent.name).to.equal("c");
      expect(newParent.position!.index).to.equal(1);
      checkTree(root);
    });
  });

  describe("mergeIntoLeftFromRight()", () => {
    it("merges a node into another node", () => {
      TestTree.mergeIntoLeftFromRight(parents.c1, parents.c2);
      expect(parents.c1.children.map(c => c?.name)).to.deep.equal([
        "c1a",
        "c1b",
        "c1c",
        "c2a",
        "c2b",
      ]);
      expect(parents.c2.children.map(c => c?.name)).to.deep.equal([]);
      expect(parents.c2.position).to.be.undefined;
      checkTree(root);
    });
  });
});
