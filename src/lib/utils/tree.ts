interface TreeNode {
  id: string;
  parent_id: string | null;
}

/** Children of each node, keyed by parent id (null = top level). Input order is kept. */
export function groupByParent<T extends TreeNode>(nodes: T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const n of nodes) {
    const list = map.get(n.parent_id);
    if (list) list.push(n);
    else map.set(n.parent_id, [n]);
  }
  return map;
}

/** Ids of `rootId` and everything below it. */
export function subtreeIds<T extends TreeNode>(nodes: T[] | Map<string | null, T[]>, rootId: string): Set<string> {
  const children = nodes instanceof Map ? nodes : groupByParent(nodes);
  const ids = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return ids;
}

/** Nodes from the top level down to `id` (inclusive), e.g. for a breadcrumb. */
export function pathTo<T extends TreeNode>(byId: Map<string, T>, id: string | null): T[] {
  const out: T[] = [];
  let node = id ? byId.get(id) : undefined;
  while (node && out.length <= byId.size) {
    out.unshift(node);
    node = node.parent_id ? byId.get(node.parent_id) : undefined;
  }
  return out;
}
