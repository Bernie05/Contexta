"use client";

import { useState } from "react";
import { isFileDrag, isInternalDrag } from "@/lib/api";

/**
 * Makes an element accept drops of desktop files and of items dragged inside the app.
 * Spread `dropProps` on the element and use `over` to highlight it.
 * `nested` stops the event so a parent drop zone doesn't also handle it.
 */
export function useDropTarget(onDrop: (e: React.DragEvent) => void, { nested = false } = {}) {
  const [over, setOver] = useState(false);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!isFileDrag(e) && !isInternalDrag(e)) return;
      e.preventDefault();
      if (nested) e.stopPropagation();
      e.dataTransfer.dropEffect = isFileDrag(e) ? "copy" : "move";
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Ignore leaves into the element's own children.
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (nested) e.stopPropagation();
      setOver(false);
      onDrop(e);
    },
  };

  return { over, dropProps };
}
