import {expect} from "chai";

import {
  isChildInParent,
  pathTo,
  setPosition,
  type TreeNode,
  type TreeParent,
  type TreePosition,
} from "./tree";

export interface TestNode extends TreeNode<TestParent, TestNode> {
  name: string;
  position: TestPosition | undefined;
}

export interface TestParent extends TestNode, TreeParent<TestParent, TestNode> {
  children: TestNode[];
}

export type TestPosition = TreePosition<TestParent, TestNode>;

export type TestNodeDef = string | TestParentDef;
export type TestParentDef = {name: string; children: TestNodeDef[]};

export function makeTree(
  def: TestParentDef,
): [TestParent, Record<string, TestParent>, Record<string, TestNode>] {
  const parents: Record<string, TestParent> = {};
  const nodes: Record<string, TestNode> = {};

  function inner(def: TestNodeDef): TestNode {
    if (typeof def === "string") {
      const n = {name: def, position: undefined};
      nodes[def] = n;
      return n;
    }

    const n: TestParent = {
      name: def.name,
      position: undefined,
      children: [],
    };
    n.children = def.children.map((d, i) => {
      const c = inner(d);
      c.position = {parent: n, index: i};
      return c;
    });
    nodes[def.name] = n;
    parents[def.name] = n;
    return n;
  }

  return [inner(def) as TestParent, parents, nodes];
}

export function checkTree(root: TestParent) {
  function checkNode(n: TestNode) {
    if ("children" in n) {
      let idx = 0;
      for (const c of n.children as TestNode[]) {
        const pos = c.position!;
        expect(pos, `${c.name} has a position`).to.not.be.undefined;
        expect(pos.parent, `${c.name}'s position parent is ${n.name}`).to.equal(
          n,
        );
        expect(pos.index, `${c.name}'s position index is ${idx}`).to.equal(idx);
        checkNode(c);
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
      {name: "b", children: ["b1", "b2"]},
      {
        name: "c",
        children: [
          {name: "c1", children: ["c1a", "c1b", "c1c"]},
          {
            name: "c2",
            children: [
              "c2a",
              {name: "c2b", children: ["c2b1", "c2b2", "c2b3"]},
            ],
          },
        ],
      },
      "d",
      {name: "e", children: ["e1", "e2"]},
    ],
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
      expect(isChildInParent(nodes.c2b1, parents.c)).to.be.true);
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
      expect(pathTo(nodes.c2b3)).to.deep.equal([
        nodes.c.position,
        nodes.c2.position,
        nodes.c2b.position,
        nodes.c2b3.position,
      ]));
  });

  describe("setPosition()", () => {
    function test(
      desc: string,
      node: () => TestNode,
      position: () => TestPosition | undefined,
      after?: (node: TestNode, position: TestPosition | undefined) => void,
    ) {
      it(desc, () => {
        const n = node();
        const pos = position();
        setPosition(n, pos);

        expect(n.position).to.deep.equal(pos);
        if (pos) {
          expect(pos?.parent.children[pos.index]).to.equal(n);
          expect(n.position!.parent).to.equal(pos.parent);
          expect(n.position!.index).to.equal(pos.index);
        }

        checkTree(tree);
        if (after) after(n, pos);
      });
    }

    for (const [pos, index] of [
      ["beginning", 0],
      ["middle", 2],
      ["end-1", 4],
      ["end-1", 5],
    ] as const) {
      test(
        `inserts a node at the ${pos} of its parent`,
        () => ({name: "new", position: undefined}),
        () => ({parent: parents.root, index}),
        (n, pos) => {
          if (index < parents.root.children.length - 1) {
            expect(parents.root.children[index + 1].position?.index).to.equal(
              index + 1,
            );
          }
        },
      );
    }

    for (const [pos, child] of [
      ["beginning", "a"],
      ["middle", "c"],
      ["end", "e"],
    ] as const) {
      test(
        `removes a node at the ${pos} of its parent`,
        () => nodes[child],
        () => undefined,
      );
    }

    test(
      "rotates a node from the middle to the beginning of its parent",
      () => nodes.b,
      () => ({parent: parents.root, index: 0}),
      (child, pos) => {
        expect(parents.root.children).to.deep.equal([
          nodes.b,
          nodes.a,
          nodes.c,
          nodes.d,
          nodes.e,
        ]);
        expect(child.position?.index).to.equal(0);
      },
    );
    test(
      "rotates a node from the middle to the end of its parent",
      () => nodes.b,
      () => ({parent: parents.root, index: 4}),
      (child, pos) => {
        expect(parents.root.children).to.deep.equal([
          nodes.a,
          nodes.c,
          nodes.d,
          nodes.e,
          nodes.b,
        ]);
        expect(child.position?.index).to.equal(4);
      },
    );
    test(
      "rotates a node from the middle to past the end of its parent",
      () => nodes.b,
      () => ({parent: parents.root, index: 5}),
      (child, pos) => {
        expect(parents.root.children).to.deep.equal([
          nodes.a,
          nodes.c,
          nodes.d,
          nodes.e,
          nodes.b,
        ]);
        expect(child.position?.index).to.equal(4);
      },
    );

    test(
      "moves a node to the beginning of a new parent",
      () => nodes.a,
      () => ({parent: parents.c1, index: 0}),
      () => {
        expect(parents.root.children).to.deep.equal(
          ["b", "c", "d", "e"].map(i => nodes[i]),
        );
        expect(parents.c1.children).to.deep.equal(
          ["a", "c1a", "c1b", "c1c"].map(i => nodes[i]),
        );
      },
    );
    test(
      "moves a node to the middle of a new parent",
      () => nodes.a,
      () => ({parent: parents.c1, index: 1}),
      () => {
        expect(parents.root.children).to.deep.equal(
          ["b", "c", "d", "e"].map(i => nodes[i]),
        );
        expect(parents.c1.children).to.deep.equal(
          ["c1a", "a", "c1b", "c1c"].map(i => nodes[i]),
        );
      },
    );
    test(
      "moves a node to one before the end of a new parent",
      () => nodes.a,
      () => ({parent: parents.c1, index: 2}),
      () => {
        expect(parents.root.children).to.deep.equal(
          ["b", "c", "d", "e"].map(i => nodes[i]),
        );
        expect(parents.c1.children).to.deep.equal(
          ["c1a", "c1b", "a", "c1c"].map(i => nodes[i]),
        );
      },
    );
    test(
      "moves a node to the end of a new parent",
      () => nodes.a,
      () => ({parent: parents.c1, index: 3}),
      () => {
        expect(parents.root.children).to.deep.equal(
          ["b", "c", "d", "e"].map(i => nodes[i]),
        );
        expect(parents.c1.children).to.deep.equal(
          ["c1a", "c1b", "c1c", "a"].map(i => nodes[i]),
        );
      },
    );
  });
});
