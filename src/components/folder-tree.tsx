"use client";

import { useState } from "react";
import { ChevronRight, Folder as FolderIcon, FolderOpen, Library, Plus } from "lucide-react";
import { useDropTarget } from "@/hooks/use-drop-target";
import { setDragItems } from "@/lib/api";
import type { Folder } from "@/lib/types";
import { groupByParent, toggled } from "@/lib/utils";
import { folderMenu, type ItemAction } from "./document-pane";
import { ActionMenu, type MenuItem } from "./ui";

interface Props {
  folders: Folder[];
  currentId: string | null;
  docCounts: Map<string | null, number>;
  onOpen: (id: string | null) => void;
  /** Drop handler for internal moves and OS file uploads onto a folder (null = root). */
  onDrop: (e: React.DragEvent, targetId: string | null) => void;
  /** Create a folder inside `parentId` (null = top level). */
  onNewFolder: (parentId: string | null) => void;
  /** Rename, move, delete and other folder actions from the row's ⋯ menu. */
  onAction: (action: ItemAction) => void;
}

export function FolderTree({ folders, currentId, docCounts, onOpen, onDrop, onNewFolder, onAction }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const children = groupByParent(folders);
  const toggle = (id: string) => setCollapsed((s) => toggled(s, id));

  // Expand the parent so the new subfolder is visible once it's created.
  const addInside = (parentId: string) => {
    setCollapsed((s) => toggled(s, parentId, false));
    onNewFolder(parentId);
  };

  return (
    <nav aria-label="Folders" className="flex flex-col gap-0.5 text-sm">
      <TreeRow
        label="Library"
        icon={<Library size={16} />}
        active={currentId === null}
        depth={0}
        count={docCounts.get(null)}
        onClick={() => onOpen(null)}
        onDrop={(e) => onDrop(e, null)}
        onAdd={() => onNewFolder(null)}
      />
      {renderLevel(null, 1)}
    </nav>
  );

  function renderLevel(parentId: string | null, depth: number): React.ReactNode {
    return (children.get(parentId) ?? []).map((f) => {
      const hasChildren = (children.get(f.id)?.length ?? 0) > 0;
      const isOpen = !collapsed.has(f.id);
      return (
        <div key={f.id}>
          <TreeRow
            label={f.name}
            icon={currentId === f.id ? <FolderOpen size={16} /> : <FolderIcon size={16} />}
            active={currentId === f.id}
            depth={depth}
            count={docCounts.get(f.id)}
            expander={hasChildren ? { open: isOpen, toggle: () => toggle(f.id) } : undefined}
            onClick={() => onOpen(f.id)}
            onDrop={(e) => onDrop(e, f.id)}
            onAdd={() => addInside(f.id)}
            menu={folderMenu(f, (a) => (a.kind === "newSubfolder" ? addInside(f.id) : onAction(a)))}
            dragId={f.id}
          />
          {hasChildren && isOpen && renderLevel(f.id, depth + 1)}
        </div>
      );
    });
  }
}

function TreeRow({
  label,
  icon,
  active,
  depth,
  count,
  expander,
  onClick,
  onDrop,
  onAdd,
  menu,
  dragId,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  depth: number;
  count?: number;
  expander?: { open: boolean; toggle: () => void };
  onClick: () => void;
  onDrop: (e: React.DragEvent) => void;
  onAdd: () => void;
  menu?: MenuItem[];
  dragId?: string;
}) {
  const { over, dropProps } = useDropTarget(onDrop, { nested: true });
  return (
    <div
      draggable={Boolean(dragId)}
      onDragStart={(e) => {
        if (dragId) setDragItems(e, [{ kind: "folder", id: dragId }]);
      }}
      {...dropProps}
      className={`group relative flex items-center rounded-md pr-2 transition-colors ${
        over ? "bg-accent-soft ring-1 ring-accent" : active ? "bg-accent-soft text-accent" : "hover:bg-surface-muted"
      }`}
      style={{ paddingLeft: depth * 12 + 4 }}
    >
      <button
        aria-label={expander ? (expander.open ? `Collapse ${label}` : `Expand ${label}`) : undefined}
        tabIndex={expander ? 0 : -1}
        onClick={expander?.toggle}
        className={`flex h-6 w-5 shrink-0 items-center justify-center text-muted ${expander ? "" : "invisible"}`}
      >
        <ChevronRight size={14} className={`transition-transform ${expander?.open ? "rotate-90" : ""}`} />
      </button>
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
        <span className={active ? "text-accent" : "text-muted"}>{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {count ? <span className="ml-1 text-xs text-muted">{count}</span> : null}
      {/* Row actions sit over the count and appear on hover or keyboard focus. */}
      <div
        className={`pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 ${
          active || over ? "bg-accent-soft" : "bg-surface-muted"
        }`}
      >
        <button
          onClick={onAdd}
          aria-label={`New folder inside ${label}`}
          title={`New folder inside ${label}`}
          className="rounded p-1 text-muted hover:bg-surface hover:text-accent"
        >
          <Plus size={14} />
        </button>
        {menu && <ActionMenu label={`Actions for ${label}`} items={menu} />}
      </div>
    </div>
  );
}
