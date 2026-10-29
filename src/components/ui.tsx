"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, MoreHorizontal } from "lucide-react";
import { useAsyncAction } from "@/hooks/use-async-action";

const MODAL_WIDTH = { sm: "max-w-sm", md: "max-w-2xl", lg: "h-[min(820px,calc(100vh-2rem))] max-w-4xl" };

export function Modal({
  title,
  onClose,
  children,
  size = "sm",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-xl border border-border bg-surface p-5 shadow-xl ${MODAL_WIDTH[size]}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-accent text-white dark:text-black hover:opacity-90",
    secondary: "border border-border bg-surface hover:bg-surface-muted",
    danger: "bg-danger text-white dark:text-black hover:opacity-90",
    ghost: "hover:bg-surface-muted",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent ${styles} ${className}`}
      {...props}
    />
  );
}

/** Standard text field; pass `label` to wrap it in a caption. */
export function TextInput({
  label,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  const input = (
    <input
      className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent ${
        label ? "mt-1" : ""
      } ${className}`}
      {...props}
    />
  );
  if (!label) return input;
  return (
    <label className="block text-xs text-muted">
      {label}
      {input}
    </label>
  );
}

/** Error line plus Cancel and the main action, shared by every dialog. */
export function DialogFooter({
  error,
  busy,
  actionLabel,
  variant = "primary",
  disabled = false,
  onCancel,
  onAction,
  className = "mt-4",
}: {
  error: string | null;
  busy: boolean;
  actionLabel: ReactNode;
  variant?: "primary" | "danger";
  disabled?: boolean;
  onCancel: () => void;
  /** Omit to make the action a form submit button. */
  onAction?: () => void;
  className?: string;
}) {
  return (
    <>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className={`flex justify-end gap-2 ${className}`}>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type={onAction ? "button" : "submit"} variant={variant} disabled={busy || disabled} onClick={onAction}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {actionLabel}
        </Button>
      </div>
    </>
  );
}

export function PromptDialog({
  title,
  label,
  initial = "",
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const { busy, error, run } = useAsyncAction();

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (value.trim() && (await run(() => onSubmit(value.trim())))) onClose();
        }}
      >
        <TextInput
          label={label}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <DialogFooter error={error} busy={busy} actionLabel={submitLabel} disabled={!value.trim()} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { busy, error, run } = useAsyncAction();
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-sm text-muted">{message}</div>
      <DialogFooter
        className="mt-5"
        error={error}
        busy={busy}
        actionLabel={confirmLabel}
        variant="danger"
        onCancel={onClose}
        onAction={async () => {
          if (await run(onConfirm)) onClose();
        }}
      />
    </Modal>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A "⋯" button that opens a small action menu. */
/** A menu behind a "⋯" button, or behind a custom `trigger` such as a "+ New" button. */
export function ActionMenu({ items, label, trigger }: { items: MenuItem[]; label: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={
          trigger
            ? "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
            : "rounded-md p-1 text-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        }
      >
        {trigger ?? <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted disabled:opacity-40 ${
                item.danger ? "text-danger" : ""
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
