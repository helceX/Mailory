import {
  newBlockId,
  type Block,
  type ColumnsBlock,
  type EmailDoc,
  type LeafBlock,
} from "@mailory/core/shared";

/**
 * Pure helpers the editor uses to change a document. Everything is immutable (returns a new doc) so
 * React state updates are trivial, and the logic is unit-tested without a browser.
 */

export type Location = {
  block: Block;
  topIndex: number;
  column?: number;
  index?: number;
  parent?: ColumnsBlock;
};

export function locate(doc: EmailDoc, id: string): Location | null {
  for (let i = 0; i < doc.blocks.length; i++) {
    const block = doc.blocks[i]!;
    if (block.id === id) return { block, topIndex: i };
    if (block.type === "columns") {
      for (let c = 0; c < block.columns.length; c++) {
        const j = block.columns[c]!.findIndex((b) => b.id === id);
        if (j !== -1)
          return {
            block: block.columns[c]![j]!,
            topIndex: i,
            column: c,
            index: j,
            parent: block,
          };
      }
    }
  }
  return null;
}

export function updateBlock(
  doc: EmailDoc,
  id: string,
  patch: (block: Block) => Block,
): EmailDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.id === id) return patch(b);
      if (
        b.type === "columns" &&
        b.columns.some((col) => col.some((c) => c.id === id))
      ) {
        return {
          ...b,
          columns: b.columns.map((col) =>
            col.map((c) => (c.id === id ? (patch(c) as LeafBlock) : c)),
          ),
        };
      }
      return b;
    }),
  };
}

export function removeBlock(doc: EmailDoc, id: string): EmailDoc {
  return {
    ...doc,
    blocks: doc.blocks
      .filter((b) => b.id !== id)
      .map((b) =>
        b.type === "columns"
          ? { ...b, columns: b.columns.map((col) => col.filter((c) => c.id !== id)) }
          : b,
      ),
  };
}

/** Insert at a top-level index (clamped). */
export function insertBlock(doc: EmailDoc, block: Block, index: number): EmailDoc {
  const at = Math.max(0, Math.min(index, doc.blocks.length));
  return {
    ...doc,
    blocks: [...doc.blocks.slice(0, at), block, ...doc.blocks.slice(at)],
  };
}

/** Move within the top level, or within one column of a columns block (by ±1). */
export function moveBlock(doc: EmailDoc, id: string, delta: -1 | 1): EmailDoc {
  const loc = locate(doc, id);
  if (!loc) return doc;
  const swap = <T>(list: T[], i: number): T[] => {
    const j = i + delta;
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy;
  };
  if (!loc.parent) return { ...doc, blocks: swap(doc.blocks, loc.topIndex) };
  return {
    ...doc,
    blocks: doc.blocks.map((b, i) =>
      i === loc.topIndex && b.type === "columns"
        ? {
            ...b,
            columns: b.columns.map((col, c) =>
              c === loc.column ? swap(col, loc.index!) : col,
            ),
          }
        : b,
    ),
  };
}

/** Drag-and-drop reorder of top-level blocks. */
export function reorder(doc: EmailDoc, fromId: string, toId: string): EmailDoc {
  const from = doc.blocks.findIndex((b) => b.id === fromId);
  const to = doc.blocks.findIndex((b) => b.id === toId);
  if (from === -1 || to === -1 || from === to) return doc;
  const blocks = [...doc.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved!);
  return { ...doc, blocks };
}

/** Deep copy with fresh ids everywhere (ids must stay unique across the document). */
export function cloneWithNewIds<T extends Block>(block: T): T {
  if (block.type === "columns")
    return {
      ...block,
      id: newBlockId(),
      columns: block.columns.map((col) => col.map((c) => ({ ...c, id: newBlockId() }))),
    } as T;
  return { ...block, id: newBlockId() } as T;
}

export function duplicateBlock(
  doc: EmailDoc,
  id: string,
): { doc: EmailDoc; newId: string | null } {
  const loc = locate(doc, id);
  if (!loc) return { doc, newId: null };
  const copy = cloneWithNewIds(loc.block);
  if (!loc.parent)
    return { doc: insertBlock(doc, copy, loc.topIndex + 1), newId: copy.id };
  return {
    doc: {
      ...doc,
      blocks: doc.blocks.map((b, i) =>
        i === loc.topIndex && b.type === "columns"
          ? {
              ...b,
              columns: b.columns.map((col, c) =>
                c === loc.column
                  ? [
                      ...col.slice(0, loc.index! + 1),
                      copy as LeafBlock,
                      ...col.slice(loc.index! + 1),
                    ]
                  : col,
              ),
            }
          : b,
      ),
    },
    newId: copy.id,
  };
}

/** Change the number of columns (2 or 3), keeping content: extra columns' blocks fold into the last one. */
export function setColumnCount(doc: EmailDoc, id: string, count: 2 | 3): EmailDoc {
  return updateBlock(doc, id, (b) => {
    if (b.type !== "columns" || b.columns.length === count) return b;
    if (count > b.columns.length)
      return {
        ...b,
        columns: [
          ...b.columns,
          ...Array.from({ length: count - b.columns.length }, () => [] as LeafBlock[]),
        ],
      };
    const kept = b.columns.slice(0, count);
    kept[count - 1] = [...kept[count - 1]!, ...b.columns.slice(count).flat()];
    return { ...b, columns: kept };
  });
}

export function addToColumn(
  doc: EmailDoc,
  columnsId: string,
  column: number,
  block: LeafBlock,
): EmailDoc {
  return updateBlock(doc, columnsId, (b) =>
    b.type === "columns"
      ? {
          ...b,
          columns: b.columns.map((col, i) => (i === column ? [...col, block] : col)),
        }
      : b,
  );
}

export function countBlocks(doc: EmailDoc): number {
  return doc.blocks.reduce(
    (n, b) =>
      n + 1 + (b.type === "columns" ? b.columns.reduce((m, c) => m + c.length, 0) : 0),
    0,
  );
}
