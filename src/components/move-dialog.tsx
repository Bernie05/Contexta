"use client";

import { useState } from "react";
import { Folder as FolderIcon, Library } from "lucide-react";
import { useAsyncAction } from "@/hooks/use-async-action";
import type { Folder } from "@/lib/types";
import { groupByParent } from "@/lib/utils";
import { DialogFooter, Modal } from "./ui";

/** Folder picker for "Move to…". `excluded` hides folders that can't be targets (a folder and its subtree). */
export function MoveDialog({
  itemName,
  folders,
  currentFolderId,
  excluded = new Set<string>(),
  onMove,
  onClose,
}: {
  itemName: string;
  folders: Folder[];
  currentFolderId: string | null;
  excluded?: Set<string>;
  onMove: (folderId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(currentFolderId);
  const { busy, error, run } = useAsyncAction();

  // Flatten the tree depth-first into indented rows.
  const children = groupByParent(folders.filter((f) => !excluded.has(f.id)));
  const rows: { id: string | null; name: string; depth: number }[] = [{ id: null, name: "Library (top level)", depth: 0 }];
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      rows.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);

  return (
    <Modal title={`Move "${itemName}"`} onClose={onClose}>
      <div role="listbox" aria-label="Destination folder" className="max-h-72 overflow-y-auto rounded-lg border border-border p-1">
        {rows.map((r) => (
          <button
            key={r.id ?? "root"}
            role="option"
            aria-selected={target === r.id}
            onClick={() => setTarget(r.id)}
            className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm ${
              target === r.id ? "bg-accent-soft text-accent" : "hover:bg-surface-muted"
            }`}
            style={{ paddingLeft: r.depth * 14 + 8 }}
          >
            {r.id === null ? <Library size={15} /> : <FolderIcon size={15} />}
            <span className="truncate">{r.name}</span>
          </button>
        ))}
      </div>
      <DialogFooter
        error={error}
        busy={busy}
        actionLabel="Move here"
        disabled={target === currentFolderId}
        onCancel={onClose}
        onAction={async () => {
          if (await run(() => onMove(target))) onClose();
        }}
      />
    </Modal>
  );
}
