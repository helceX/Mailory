import { describe, expect, it } from "vitest";
import {
  createBlock,
  createEmptyDoc,
  walkBlocks,
  type Block,
  type EmailDoc,
  type LeafBlock,
  type ParagraphBlock,
} from "@mailory/core/shared";
import {
  addToColumn,
  cloneWithNewIds,
  countBlocks,
  duplicateBlock,
  insertBlock,
  locate,
  moveBlock,
  removeBlock,
  reorder,
  setColumnCount,
  updateBlock,
} from "./doc-utils";

const para = (id: string, text = id): ParagraphBlock => ({
  ...(createBlock("paragraph") as ParagraphBlock),
  id,
  text,
});
const docOf = (...blocks: Block[]): EmailDoc => ({ ...createEmptyDoc(), blocks });
const ids = (doc: EmailDoc) => doc.blocks.map((b) => b.id);
const allIds = (doc: EmailDoc) => {
  const out: string[] = [];
  walkBlocks(doc, (b) => out.push(b.id));
  return out;
};

describe("doc-utils", () => {
  it("locates top-level and column blocks", () => {
    const cols = {
      ...(createBlock("columns") as Extract<Block, { type: "columns" }>),
      id: "cols",
      columns: [[para("a")], [para("b"), para("c")]],
    };
    const doc = docOf(para("x"), cols);
    expect(locate(doc, "x")).toMatchObject({ topIndex: 0 });
    expect(locate(doc, "c")).toMatchObject({ topIndex: 1, column: 1, index: 1 });
    expect(locate(doc, "nope")).toBeNull();
  });
  it("updates, removes and inserts without mutating the original", () => {
    const doc = docOf(para("a"), para("b"));
    const snapshot = JSON.stringify(doc);
    const updated = updateBlock(doc, "a", (b) => ({
      ...(b as ParagraphBlock),
      text: "new",
    }));
    expect((updated.blocks[0] as ParagraphBlock).text).toBe("new");
    expect(ids(removeBlock(doc, "a"))).toEqual(["b"]);
    expect(ids(insertBlock(doc, para("z"), 1))).toEqual(["a", "z", "b"]);
    expect(ids(insertBlock(doc, para("z"), 99))).toEqual(["a", "b", "z"]);
    expect(ids(insertBlock(doc, para("z"), -5))).toEqual(["z", "a", "b"]);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });
  it("moves blocks up and down and stops at the ends", () => {
    const doc = docOf(para("a"), para("b"), para("c"));
    expect(ids(moveBlock(doc, "b", -1))).toEqual(["b", "a", "c"]);
    expect(ids(moveBlock(doc, "b", 1))).toEqual(["a", "c", "b"]);
    expect(ids(moveBlock(doc, "a", -1))).toEqual(["a", "b", "c"]);
    expect(ids(moveBlock(doc, "c", 1))).toEqual(["a", "b", "c"]);
  });
  it("moves blocks inside a column without leaving it", () => {
    const cols = {
      ...(createBlock("columns") as Extract<Block, { type: "columns" }>),
      id: "cols",
      columns: [[para("a"), para("b")], [para("c")]],
    };
    const moved = moveBlock(docOf(cols), "a", 1).blocks[0] as typeof cols;
    expect(moved.columns[0]!.map((b) => b.id)).toEqual(["b", "a"]);
    expect(moved.columns[1]!.map((b) => b.id)).toEqual(["c"]);
  });
  it("reorders for drag and drop", () => {
    const doc = docOf(para("a"), para("b"), para("c"));
    expect(ids(reorder(doc, "a", "c"))).toEqual(["b", "c", "a"]);
    expect(ids(reorder(doc, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(reorder(doc, "a", "a")).toBe(doc);
    expect(reorder(doc, "a", "missing")).toBe(doc);
  });
  it("duplicating keeps every id unique (also for columns)", () => {
    const cols = {
      ...(createBlock("columns") as Extract<Block, { type: "columns" }>),
      id: "cols",
      columns: [[para("a")], [para("b")]],
    };
    const { doc, newId } = duplicateBlock(docOf(para("x"), cols), "cols");
    expect(newId).not.toBe("cols");
    expect(doc.blocks).toHaveLength(3);
    const all = allIds(doc);
    expect(new Set(all).size).toBe(all.length);
    const inCol = duplicateBlock(docOf(cols), "a");
    const all2 = allIds(inCol.doc);
    expect(new Set(all2).size).toBe(all2.length);
    expect(countBlocks(inCol.doc)).toBe(4);
  });
  it("cloneWithNewIds never reuses an id", () => {
    const original = createBlock("columns");
    const copy = cloneWithNewIds(original);
    const a = allIds(docOf(original));
    const b = allIds(docOf(copy));
    expect(a.some((id) => b.includes(id))).toBe(false);
  });
  it("changes column count without losing content", () => {
    const cols = {
      ...(createBlock("columns") as Extract<Block, { type: "columns" }>),
      id: "cols",
      columns: [[para("a")], [para("b")], [para("c")]],
    };
    const two = setColumnCount(docOf(cols), "cols", 2).blocks[0] as typeof cols;
    expect(two.columns.map((c) => c.map((b) => b.id))).toEqual([["a"], ["b", "c"]]);
    const three = setColumnCount(docOf(two), "cols", 3).blocks[0] as typeof cols;
    expect(three.columns).toHaveLength(3);
    expect(three.columns[2]).toEqual([]);
  });
  it("adds a leaf to a specific column", () => {
    const cols = {
      ...(createBlock("columns") as Extract<Block, { type: "columns" }>),
      id: "cols",
      columns: [[], []] as LeafBlock[][],
    };
    const out = addToColumn(docOf(cols), "cols", 1, para("n")).blocks[0] as typeof cols;
    expect(out.columns[1]!.map((b) => b.id)).toEqual(["n"]);
  });
});
