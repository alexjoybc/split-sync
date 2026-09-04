"use client";

/**
 * SoloSessionSwitcher — panel UI for managing local solo stopwatch sessions.
 *
 * Implements the multi-session UX described in ADR 0024.
 * Reads/writes via soloSessionStorage.ts (the storage layer from #365).
 *
 * MD3 redesign (#444): uses `@material/web`'s `md-dialog` + `md-list` /
 * `md-list-item` from the scoped stopwatch theme (`md3-theme.css`,
 * `md3-components.ts`, ADR 0026) instead of the hand-rolled overlay. All
 * create/rename/switch/delete/reorder behavior from the original panel is
 * unchanged — this is a markup/styling pass only.
 *
 * A note on React 19 + `@material/web` custom elements: React 19 sets a
 * prop as a DOM *property* on a custom element whenever that property
 * already exists on the element instance (e.g. `open`, `value`,
 * `maxLength`), and falls back to an attribute otherwise. `@material/web`
 * text fields and `md-dialog` redispatch plain, composed, bubbling DOM
 * events (`input`, `change`, `cancel`, `closed`) directly from the host
 * element, so plain `onInput`/`value` JSX props work for controlled text
 * fields. `md-dialog`'s `open` is a manual accessor (not a Lit
 * `@property`), so it is set imperatively via property assignment — which
 * is exactly what React does for a boolean JSX prop that matches an
 * existing instance property. Closing is always driven through the
 * element's own `close()` method (never by unmounting first) so the
 * `closed` event — listened to imperatively via `ref` + `addEventListener`
 * to sidestep any ambiguity in custom-event-name-to-JSX-prop mapping — is
 * the single source of truth for telling the caller the panel is done.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { TrashIcon, PencilIcon, Bars3Icon, XMarkIcon, CheckIcon } from "@heroicons/react/20/solid";
// `stopwatch/layout.tsx` (a Server Component) already imports
// `./md3-components` for its side effect of registering `@material/web`
// custom elements — but that registration only runs during SSR, since a
// plain import in a Server Component is never included in the client
// bundle. This file is the first screen to actually render `<md-*>`
// elements, so it re-imports the registrations here to guarantee they run
// in the browser wherever this client component's chunk is loaded.
import "./md3-components";
import {
  listSessions,
  createSession,
  updateSession,
  deleteSession,
  reorderSessions,
  getActiveSessionId,
  SESSION_CAP,
  type SoloSessionRecord,
} from "./soloSessionStorage";

// ---------------------------------------------------------------------------
// `@material/web` custom element JSX typings
// ---------------------------------------------------------------------------
//
// `apps/web` has no global JSX declarations for `@material/web` custom
// elements yet (this is the first file in the repo to render them, rather
// than only side-effect-import their definitions). Scoped to this file —
// broaden into a shared `.d.ts` if a second stopwatch screen adopts these
// same elements.

type MdElementProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement>,
  HTMLElement
>;

type MdDialogProps = MdElementProps & {
  open?: boolean;
  quick?: boolean;
  type?: "alert";
  "aria-label"?: string;
};

// `[prop: string]: unknown` keeps these permissive enough to also cover
// `md-outlined-text-field` / `md-outlined-button` usage in CountdownTimer.tsx
// (#443) — the same two custom elements, first typed here for this file's
// dialog/list panel, then reused for the countdown timer's setup form and
// fullscreen toggle. A shared `.d.ts` would be cleaner if a third screen
// adopts either element.
type MdTextFieldProps = MdElementProps & {
  value?: string;
  label?: string;
  maxLength?: number;
  autofocus?: boolean;
  onInput?: React.FormEventHandler<HTMLElement>;
  [prop: string]: unknown;
};

type MdButtonProps = MdElementProps & {
  disabled?: boolean;
  [prop: string]: unknown;
};

type MdIconButtonProps = MdElementProps & {
  disabled?: boolean;
  "aria-label"?: string;
  "aria-pressed"?: boolean | "true" | "false";
};

type MdListItemProps = MdElementProps & {
  type?: "text" | "button" | "link";
};

// React 19's `react-jsx` runtime resolves `JSX.IntrinsicElements` from the
// `JSX` namespace re-exported by the "react" module (not the old bare
// global `JSX` namespace), so the augmentation has to target that module.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-dialog": MdDialogProps;
      "md-list": MdElementProps;
      "md-list-item": MdListItemProps;
      "md-icon-button": MdIconButtonProps;
      "md-outlined-text-field": MdTextFieldProps;
      "md-filled-button": MdButtonProps;
      "md-outlined-button": MdButtonProps;
      "md-text-button": MdButtonProps;
    }
  }
}

/** Minimal shape of the `md-dialog` custom element's public API we use. */
interface MdDialogElement extends HTMLElement {
  open: boolean;
  close(returnValue?: string): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface SessionStatus {
  label: string;
  running: boolean;
}

function sessionStatus(session: SoloSessionRecord): SessionStatus {
  if (
    session.stopwatchState?.state === "running" ||
    session.timerState?.state === "running"
  ) {
    return { label: "RUNNING", running: true };
  }
  if (
    session.stopwatchState?.state === "stopped" ||
    session.timerState?.state === "paused"
  ) {
    return { label: "PAUSED", running: false };
  }
  return { label: "IDLE", running: false };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SoloSessionSwitcherProps {
  /** Currently active session id (from page state — may differ from storage
   *  if a switch is in-flight, but in practice they're in sync). */
  activeSessionId: string | null;
  /** Called when the user picks a different session to activate. */
  onSwitch: (sessionId: string) => void;
  /** Called when the panel should close (Escape, backdrop click, ✕). */
  onClose: () => void;
}

export function SoloSessionSwitcher({
  activeSessionId,
  onSwitch,
  onClose,
}: SoloSessionSwitcherProps) {
  const [sessions, setSessions] = useState<SoloSessionRecord[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // Drag-to-reorder state
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragSourceIdRef = useRef<string | null>(null);

  // Keyboard drag-to-reorder state
  const [keyboardDragId, setKeyboardDragId] = useState<string | null>(null);
  const keyboardDragOriginRef = useRef<string[]>([]);

  const dialogRef = useRef<MdDialogElement | null>(null);
  const renameInputRef = useRef<HTMLElement | null>(null);
  const newNameInputRef = useRef<HTMLElement | null>(null);

  // Load session list in index order (user-defined after first reorder).
  const refresh = useCallback(() => {
    setSessions(listSessions());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-focus the rename input whenever renaming starts.
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      (renameInputRef.current as unknown as { select?: () => void }).select?.();
    }
  }, [renamingId]);

  // Auto-focus the new-name input when creating starts.
  useEffect(() => {
    if (creating && newNameInputRef.current) {
      newNameInputRef.current.focus();
    }
  }, [creating]);

  // ── Dialog lifecycle ─────────────────────────────────────────────────────
  //
  // `md-dialog`'s `closed` event is the single point where we tell the
  // caller the panel is done — every close path (✕ button, Escape, scrim
  // click, or a completed switch/create/active-delete) goes through the
  // element's own `close()` so this fires exactly once per close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClosed = () => onClose();
    dialog.addEventListener("closed", handleClosed);
    return () => dialog.removeEventListener("closed", handleClosed);
  }, [onClose]);

  const requestClose = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  const atCap = sessions.length >= SESSION_CAP;

  // ── Create ──────────────────────────────────────────────────────────────────

  const handleCreate = useCallback(() => {
    const name = newName.trim() || `Session ${sessions.length + 1}`;
    const session = createSession(name);
    if (!session) return; // cap enforced by storage layer
    setNewName("");
    setCreating(false);
    refresh();
    onSwitch(session.id);
    requestClose();
  }, [newName, sessions.length, refresh, onSwitch, requestClose]);

  // ── Rename ──────────────────────────────────────────────────────────────────

  const handleStartRename = useCallback((session: SoloSessionRecord) => {
    setRenamingId(session.id);
    setRenameValue(session.name);
    setConfirmingDeleteId(null);
  }, []);

  const handleCommitRename = useCallback(
    (id: string) => {
      const name = renameValue.trim();
      if (name) updateSession(id, { name });
      setRenamingId(null);
      refresh();
    },
    [renameValue, refresh]
  );

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDeleteConfirm = useCallback(
    (id: string) => {
      const wasActive = id === activeSessionId;
      deleteSession(id);
      setConfirmingDeleteId(null);

      if (wasActive) {
        // Find the next session to activate (pick the newest remaining, or
        // create a fallback "Session 1" if the list is now empty).
        const remaining = listSessions();
        if (remaining.length > 0) {
          const next = remaining[remaining.length - 1]; // newest
          onSwitch(next.id);
        } else {
          const fallback = createSession("Session 1");
          if (fallback) onSwitch(fallback.id);
        }
        requestClose();
      } else {
        refresh();
      }
    },
    [activeSessionId, onSwitch, requestClose, refresh]
  );

  // ── Drag-to-reorder ─────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>, sessionId: string) => {
      dragSourceIdRef.current = sessionId;
      e.dataTransfer.effectAllowed = "move";
      // Minimal ghost text so the browser default ghost is readable
      e.dataTransfer.setData("text/plain", sessionId);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>, sessionId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (sessionId !== dragOverId) setDragOverId(sessionId);
    },
    [dragOverId]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>, targetId: string) => {
      e.preventDefault();
      setDragOverId(null);
      const sourceId = dragSourceIdRef.current;
      dragSourceIdRef.current = null;
      if (!sourceId || sourceId === targetId) return;

      setSessions((prev) => {
        const srcIdx = prev.findIndex((s) => s.id === sourceId);
        const tgtIdx = prev.findIndex((s) => s.id === targetId);
        if (srcIdx === -1 || tgtIdx === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(srcIdx, 1);
        next.splice(tgtIdx, 0, moved);
        // Persist the new order
        reorderSessions(next.map((s) => s.id));
        return next;
      });
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    dragSourceIdRef.current = null;
    setDragOverId(null);
  }, []);

  // ── Keyboard drag-to-reorder ────────────────────────────────────────────────

  /**
   * Keyboard handler for the drag handle.
   *
   * Space / Enter  — pick up (first press) or confirm + persist (second press)
   * ArrowUp / Down — move picked-up session while it is "held"
   * Escape         — cancel and restore original order
   */
  const handleDragHandleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>, sessionId: string) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (keyboardDragId === null) {
          // Pick up: snapshot current order so we can restore on Escape
          setSessions((prev) => {
            keyboardDragOriginRef.current = prev.map((s) => s.id);
            return prev;
          });
          setKeyboardDragId(sessionId);
        } else if (keyboardDragId === sessionId) {
          // Confirm / drop — persist the new order
          setSessions((prev) => {
            reorderSessions(prev.map((s) => s.id));
            return prev;
          });
          setKeyboardDragId(null);
        }
      } else if (e.key === "Escape" && keyboardDragId === sessionId) {
        e.preventDefault();
        // Cancel — restore original order without persisting
        const origIds = keyboardDragOriginRef.current;
        setSessions((prev) => {
          const byId = new Map(prev.map((s) => [s.id, s]));
          return origIds
            .map((id) => byId.get(id))
            .filter((s): s is SoloSessionRecord => s !== undefined);
        });
        setKeyboardDragId(null);
      } else if (keyboardDragId === sessionId) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.id === sessionId);
            if (idx <= 0) return prev;
            const next = [...prev];
            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
            return next;
          });
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.id === sessionId);
            if (idx === -1 || idx >= prev.length - 1) return prev;
            const next = [...prev];
            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
            return next;
          });
        }
      }
    },
    [keyboardDragId]
  );

  // ── Switch ──────────────────────────────────────────────────────────────────

  const handleSwitchAndClose = useCallback(
    (id: string) => {
      if (id === activeSessionId) {
        requestClose();
        return;
      }
      onSwitch(id);
      requestClose();
    },
    [activeSessionId, onSwitch, requestClose]
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <md-dialog
      ref={dialogRef}
      open
      quick
      aria-label="Sessions"
      data-testid="solo-session-dialog"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div slot="headline" className="flex items-center justify-between gap-2">
        <div>
          <p
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: "var(--md-sys-color-on-surface-variant)" }}
          >
            Solo stopwatch
          </p>
          <span>Sessions</span>
        </div>
        <md-icon-button onClick={requestClose} aria-label="Close sessions panel">
          <XMarkIcon className="size-5" aria-hidden="true" />
        </md-icon-button>
      </div>

      {/* ── Session list ─────────────────────────────────────────────────── */}
      <div slot="content">
        {/* `role="list"` is set explicitly in addition to `md-list`'s own
            `ElementInternals`-based role: Chromium's accessibility tree
            (and by extension Playwright's `getByRole`) does not reliably
            pick up the internals-assigned role here, so tests / assistive
            tech relying on `role="list"` need the plain attribute too. */}
        <md-list role="list" aria-label="Solo sessions">
          {sessions.length === 0 && (
            <p
              className="p-4 text-sm"
              style={{ color: "var(--md-sys-color-on-surface-variant)" }}
            >
              No sessions yet.
            </p>
          )}

          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const { label: statusLabel, running: isRunning } =
              sessionStatus(session);
            const isDragTarget = dragOverId === session.id;
            const isKeyboardDragging = keyboardDragId === session.id;
            const isRenaming = renamingId === session.id;

            return (
              <md-list-item
                key={session.id}
                type="text"
                draggable
                onDragStart={(e) =>
                  handleDragStart(e as unknown as React.DragEvent<HTMLElement>, session.id)
                }
                onDragOver={(e) =>
                  handleDragOver(e as unknown as React.DragEvent<HTMLElement>, session.id)
                }
                onDrop={(e) =>
                  handleDrop(e as unknown as React.DragEvent<HTMLElement>, session.id)
                }
                onDragEnd={handleDragEnd}
                style={
                  isDragTarget || isKeyboardDragging
                    ? { outline: "2px solid var(--md-sys-color-primary)" }
                    : isActive
                    ? { background: "var(--md-sys-color-surface-container-high)" }
                    : undefined
                }
                data-testid={`solo-session-row-${session.id}`}
              >
                {/* ── Drag handle ── */}
                <span
                  slot="start"
                  tabIndex={0}
                  role="button"
                  className="inline-flex shrink-0 cursor-grab touch-none active:cursor-grabbing focus-visible:outline focus-visible:outline-2"
                  style={{
                    color: "var(--md-sys-color-on-surface-variant)",
                    outlineColor: "var(--md-sys-color-primary)",
                  }}
                  aria-label={`Drag to reorder ${session.name}${isKeyboardDragging ? ": picked up — use Arrow keys to move, Enter to drop, Escape to cancel" : ""}`}
                  aria-pressed={isKeyboardDragging}
                  title="Drag to reorder"
                  onKeyDown={(e) => handleDragHandleKeyDown(e, session.id)}
                >
                  <Bars3Icon className="size-4" aria-hidden="true" />
                </span>

                {isRenaming ? (
                  /* ── Rename mode ── */
                  <div slot="headline" className="flex items-center gap-2">
                    <md-outlined-text-field
                      ref={renameInputRef}
                      value={renameValue}
                      onInput={(e) =>
                        setRenameValue((e.target as HTMLInputElement).value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCommitRename(session.id);
                        if (e.key === "Escape") handleCancelRename();
                      }}
                      maxLength={80}
                      label="Session name"
                      aria-label="Session name"
                      className="flex-1"
                      data-testid={`rename-input-${session.id}`}
                    />
                    <md-icon-button
                      onClick={() => handleCommitRename(session.id)}
                      aria-label="Save session name"
                      data-testid={`rename-save-${session.id}`}
                    >
                      <CheckIcon
                        className="size-4"
                        aria-hidden="true"
                        style={{ color: "var(--md-sys-color-primary)" }}
                      />
                    </md-icon-button>
                    <md-icon-button
                      onClick={handleCancelRename}
                      aria-label="Cancel rename"
                      data-testid={`rename-cancel-${session.id}`}
                    >
                      <XMarkIcon className="size-4" aria-hidden="true" />
                    </md-icon-button>
                  </div>
                ) : (
                  <>
                    {/* ── Normal mode: headline + switch action ── */}
                    <div slot="headline">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline focus-visible:outline-2"
                        style={{ outlineColor: "var(--md-sys-color-primary)" }}
                        onClick={() => handleSwitchAndClose(session.id)}
                        aria-label={`${isActive ? "Current session:" : "Switch to"} ${session.name}`}
                        data-testid={`session-switch-${session.id}`}
                      >
                        <span
                          className="truncate text-sm font-bold"
                          style={{
                            color: isActive
                              ? "var(--md-sys-color-primary)"
                              : "var(--md-sys-color-on-surface)",
                          }}
                        >
                          {session.name}
                        </span>
                        {isActive && (
                          <span
                            className="shrink-0 border px-1 text-[9px] font-black uppercase tracking-widest"
                            style={{
                              borderColor: "var(--md-sys-color-primary)",
                              color: "var(--md-sys-color-primary)",
                            }}
                            aria-label="Active"
                          >
                            ACTIVE
                          </span>
                        )}
                      </button>
                    </div>

                    <div
                      slot="supporting-text"
                      className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider"
                    >
                      <span style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
                        {session.mode === "stopwatch" ? "SW" : "TIMER"}
                      </span>
                      <span
                        style={{
                          color: isRunning
                            ? "var(--md-sys-color-error)"
                            : "var(--md-sys-color-on-surface-variant)",
                        }}
                        aria-label={`Status: ${statusLabel}`}
                      >
                        {statusLabel}
                      </span>
                      <span
                        className="normal-case font-semibold tracking-normal"
                        style={{ color: "var(--md-sys-color-on-surface-variant)" }}
                      >
                        {timeAgo(session.lastUsedAt)}
                      </span>
                    </div>

                    {/* ── Rename / delete actions ── */}
                    <div slot="end" className="flex shrink-0 items-center gap-1">
                      <md-icon-button
                        onClick={() => handleStartRename(session)}
                        aria-label={`Rename "${session.name}"`}
                        data-testid={`rename-btn-${session.id}`}
                      >
                        <PencilIcon className="size-4" aria-hidden="true" />
                      </md-icon-button>

                      {confirmingDeleteId === session.id ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <span
                            className="text-[10px] font-bold"
                            style={{ color: "var(--md-sys-color-on-surface)" }}
                          >
                            Delete?
                          </span>
                          <md-filled-button
                            onClick={() => handleDeleteConfirm(session.id)}
                            aria-label={`Confirm delete "${session.name}"`}
                            data-testid={`confirm-delete-solo-${session.id}`}
                            style={
                              {
                                "--md-filled-button-container-color":
                                  "var(--md-sys-color-error)",
                                "--md-filled-button-label-text-color":
                                  "var(--md-sys-color-on-error)",
                              } as React.CSSProperties
                            }
                          >
                            Yes
                          </md-filled-button>
                          <md-text-button
                            onClick={() => setConfirmingDeleteId(null)}
                            aria-label="Cancel delete"
                          >
                            No
                          </md-text-button>
                        </span>
                      ) : (
                        <md-icon-button
                          onClick={() => {
                            setConfirmingDeleteId(session.id);
                            setRenamingId(null);
                          }}
                          aria-label={`Delete "${session.name}"`}
                          data-testid={`delete-solo-btn-${session.id}`}
                          style={
                            {
                              "--md-icon-button-icon-color":
                                "var(--md-sys-color-error)",
                            } as React.CSSProperties
                          }
                        >
                          <TrashIcon className="size-4" aria-hidden="true" />
                        </md-icon-button>
                      )}
                    </div>
                  </>
                )}
              </md-list-item>
            );
          })}
        </md-list>
      </div>

      {/* ── Create new session ───────────────────────────────────────────── */}
      <div slot="actions" className="w-full">
        {creating ? (
          <div className="flex w-full items-center gap-2">
            <md-outlined-text-field
              ref={newNameInputRef}
              value={newName}
              onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              label={`Session ${sessions.length + 1}`}
              aria-label="New session name"
              maxLength={80}
              className="flex-1"
              data-testid="new-session-name-input"
            />
            <md-filled-button
              onClick={handleCreate}
              data-testid="create-session-confirm-btn"
            >
              Create
            </md-filled-button>
            <md-outlined-button
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancel
            </md-outlined-button>
          </div>
        ) : atCap ? (
          <p
            className="text-xs font-semibold"
            role="status"
            style={{ color: "var(--md-sys-color-on-surface-variant)" }}
            data-testid="session-cap-message"
          >
            Maximum {SESSION_CAP} sessions reached. Delete a session to create
            a new one.
          </p>
        ) : (
          <md-filled-button
            onClick={() => setCreating(true)}
            className="w-full"
            data-testid="open-create-session-btn"
          >
            + New session
          </md-filled-button>
        )}
      </div>
    </md-dialog>
  );
}
