import {expect} from "chai";

import {reactive} from "vue";
import {
  isChildInParent,
  pathTo,
  type TreeNode,
  type TreeParent,
  type TreePosition,
  placeNode,
  insertNode,
  removeNode,
} from "./tree.js";

export interface TestNode extends TreeNode<TestParent, TestNode> {
  name: string;
}

export interface TestParent
  extends TestNode,
    TreeParent<TestParent, TestNode> {}

export type TestPosition = TreePosition<TestParent, TestNode>;

export type TestNodeDef = string | TestParentDef;
export type TestParentDef = {
  name: string;
  children: (TestNodeDef | undefined)[];
  isLoaded?: boolean;
};

export function isTestParent(n: TestNode): n is TestParent {
  return "children" in n;
}

export function makeTree(
  def: TestParentDef,
): [TestParent, Record<string, TestParent>, Record<string, TestNode>] {
  const parents: Record<string, TestParent> = {};
  const nodes: Record<string, TestNode> = {};

  function inner(def: TestNodeDef): TestNode {
    if (typeof def === "string") {
      const n = reactive({name: def, position: undefined});
      nodes[def] = n;
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

    nodes[def.name] = n;
    parents[def.name] = n;
    return n;
  }

  return [inner(def) as TestParent, parents, nodes];
}

export function checkTree(root: TestParent) {
  function checkNode(n: TestNode) {
    if (isTestParent(n)) {
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

    if (!n.position) return;

    const parent = n.position.parent;
    const idx = n.position.index;
    expect(
      parent.children[idx],
      `${n.name} is present at index ${idx} in parent ${parent.name}`,
    ).to.equal(n);
  }

  expect(root.position, "root position").to.be.undefined;
  checkNode(root);
}

export const makeDefaultTree = () =>
  makeTree({
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
  });

describe("model/tree", () => {
  let [tree, parents, nodes] = makeDefaultTree();

  beforeEach(() => {
    [tree, parents, nodes] = makeDefaultTree();
    checkTree(tree);
  });

  describe("isChildInParent()", () => {
    it("nodes contain themselves", () =>
      expect(isChildInParent(nodes.root, parents.root)).to.be.true);
    it("nodes contain their direct children", () =>
      expect(isChildInParent(nodes.a, parents.root)).to.be.true);
    it("nodes contain their indirect children", () =>
      expect(isChildInParent(nodes.c2b2, parents.c)).to.be.true);
    it("nodes do not contain their siblings", () =>
      expect(isChildInParent(nodes.e, parents.c)).to.be.false);
    it("nodes do not contain their parent siblings", () =>
      expect(isChildInParent(nodes.c1, parents.e)).to.be.false);
    it("nodes do not contain children of their siblings", () =>
      expect(isChildInParent(nodes.e, parents.c1)).to.be.false);
    it("nodes do not contain their children", () =>
      expect(isChildInParent(nodes.c, parents.c2)).to.be.false);
    it("nodes do not contain their indirect children", () =>
      expect(isChildInParent(nodes.c, parents.c2b)).to.be.false);
  });

  describe("pathTo()", () => {
    it("reports an empty path for the root", () =>
      expect(pathTo(nodes.root)).to.deep.equal([]));
    it("reports the path to an immediate child of the root", () =>
      expect(pathTo(nodes.b)).to.deep.equal([nodes.b.position]));
    it("reports the path to an indirect descendant of the root", () =>
      expect(pathTo(nodes.c2b4)).to.deep.equal([
        nodes.c.position,
        nodes.c2.position,
        nodes.c2b.position,
        nodes.c2b4.position,
      ]));
  });

  describe("placeNode()", () => {
    function test(
      notes: string,
      name: keyof typeof parents,
      index: number,
      expectedChildren: (keyof typeof nodes | undefined)[],
      options?: {fails?: boolean},
    ) {
      it(`${notes}: ${options?.fails ? "fails" : "succeeds"} at ${name}[${index}]`, () => {
        const n: TestNode = reactive({name: "new", position: undefined});
        const p = reactive({parent: parents[name], index});
        if (!options?.fails) {
          placeNode(n, p);
          expect(
            p.parent.children[p.index],
            `parent.children has node`,
          ).to.equal(n);
          expect(n.position, `node.position is set`).to.equal(p);
        } else {
          expect(() => placeNode(n, p)).to.throw(Error);
          expect(n.position, `node.position is not set`).to.be.undefined;
        }
        expect(
          p.parent.children.map(c => c?.name),
          `children are as expected`,
        ).to.deep.equal(expectedChildren);
        checkTree(tree);
      });
    }

    it("crashes on node that's already in a tree", () => {
      expect(() => placeNode(nodes.c2, {parent: parents.c, index: 0})).to.throw(
        Error,
      );
      checkTree(tree);
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
      expectedChildren: (keyof typeof nodes | undefined)[],
      options?: {fails?: boolean},
    ) {
      it(`${notes}: ${options?.fails ? "fails" : "succeeds"} at ${name}[${index}]`, () => {
        const n: TestNode = reactive({name: "new", position: undefined});
        const p = reactive({parent: parents[name], index});
        if (!options?.fails) {
          insertNode(n, p);
          expect(p.parent.children[p.index]).to.equal(n);
          expect(n.position).to.deep.equal(p);
        } else {
          expect(() => insertNode(n, p)).to.throw(Error);
          expect(n.position).to.be.undefined;
        }
        expect(p.parent.children.map(c => c?.name)).to.deep.equal(
          expectedChildren,
        );
        checkTree(tree);
      });
    }

    it("crashes on node that's already in a tree", () => {
      expect(() =>
        insertNode(nodes.c2, {parent: parents.c, index: 0}),
      ).to.throw(Error);
      checkTree(tree);
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
      expectedChildren: (keyof typeof nodes | undefined)[],
      options?: {fails?: boolean},
    ) {
      it(`${notes}: ${options?.fails ? "fails" : "succeeds"} at ${name}[${index}]`, () => {
        const p = reactive({parent: parents[name], index});
        const n = parents[name].children[index];
        if (!options?.fails) {
          removeNode(p);
          expect(n?.position).to.be.undefined;
          expect(p.parent.children[p.index]).not.to.equal(n);
        } else {
          expect(() => removeNode(p)).to.throw(Error);
          expect(n?.position).not.to.be.undefined;
        }
        expect(p.parent.children.map(c => c?.name)).to.deep.equal(
          expectedChildren,
        );
        checkTree(tree);
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
});
