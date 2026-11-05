"use client";

import { useState } from "react";
import { useAsyncAction } from "@/hooks/use-async-action";
import { formatOf, URL_IMPORT_KINDS, type DocKind } from "@/lib/formats/catalog";
import { DialogFooter, Modal, TextInput } from "./ui";

/** Asks for a link and the file type to save it as. */
export function UrlDialog({
  folderName,
  onSubmit,
  onClose,
}: {
  folderName: string;
  onSubmit: (url: string, kind: DocKind) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<DocKind>(URL_IMPORT_KINDS[0]);
  const { busy, error, run } = useAsyncAction();

  return (
    <Modal title="Save from URL" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (url.trim() && (await run(() => onSubmit(url.trim(), kind)))) onClose();
        }}
      >
        <TextInput
          label="Link"
          autoFocus
          inputMode="url"
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <label className="block text-xs text-muted">
          Save as
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DocKind)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          >
            {URL_IMPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {formatOf(k).label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted">Saves the page&rsquo;s text in {folderName}. Images aren&rsquo;t included.</p>
        <DialogFooter
          className="mt-1"
          error={error}
          busy={busy}
          actionLabel={busy ? "Saving…" : "Save"}
          disabled={!url.trim()}
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}
