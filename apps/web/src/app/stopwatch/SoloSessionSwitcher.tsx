"use client";

/**
 * SoloSessionSwitcher — panel UI for managing local solo stopwatch sessions.
 *
 * Implements the multi-session UX described in ADR 0024.
 * Reads/writes via soloSessionStorage.ts (the storage layer from #365).
 *
 * Displayed as a modal overlay; caller controls visibility.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { TrashIcon, PencilIcon } from "@heroicons/react/20/solid";
import {
  listSessions,
  createSession,
  updateSession,
  deleteSession,
  getActiveSessionId,
  SESSION_CAP,
  type SoloSessionRecord,
} from "./soloSessionStorage";

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

  const renameInputRef = useRef<HTMLInputElement>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);

  // Load session list (newest first for display).
  const refresh = useCallback(() => {
    setSessions([...listSessions()].reverse());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-focus the rename input whenever renaming starts.
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Auto-focus the new-name input when creating starts.
  useEffect(() => {
    if (creating && newNameInputRef.current) {
      newNameInputRef.current.focus();
    }
  }, [creating]);

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
    onClose();
  }, [newName, sessions.length, refresh, onSwitch, onClose]);

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
        onClose();
      } else {
        refresh();
      }
    },
    [activeSessionId, onSwitch, onClose, refresh]
  );

  // ── Switch ──────────────────────────────────────────────────────────────────

  const handleSwitchAndClose = useCallback(
    (id: string) => {
      if (id === activeSessionId) {
        onClose();
        return;
      }
      onSwitch(id);
      onClose();
    },
    [activeSessionId, onSwitch, onClose]
  );

  // ── Keyboard: close on Escape ────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    /* Backdrop — clicking it closes the panel */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-race-ink/60 sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="solo-session-panel-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm border-2 border-race-ink bg-race-paper sm:max-w-md">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b-2 border-race-ink px-4 py-3">
          <div>
            <p className="race-kicker">Solo stopwatch</p>
            <h2
              id="solo-session-panel-title"
              className="text-lg font-black text-race-ink"
            >
              Sessions
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-race-muted transition-colors hover:text-race-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--race-blue-primary)]"
            aria-label="Close sessions panel"
          >
            ✕
          </button>
        </div>

        {/* ── Session list ─────────────────────────────────────────────────── */}
        <div
          className="max-h-[52vh] divide-y divide-race-line overflow-y-auto"
          role="list"
          aria-label="Solo sessions"
        >
          {sessions.length === 0 && (
            <p className="p-4 text-sm text-race-muted">No sessions yet.</p>
          )}

          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const { label: statusLabel, running: isRunning } =
              sessionStatus(session);

            return (
              <div
                key={session.id}
                role="listitem"
                className={`px-4 py-3 transition-colors ${
                  isActive ? "bg-race-panel-alt" : "hover:bg-race-panel"
                }`}
                data-testid={`solo-session-row-${session.id}`}
              >
                {renamingId === session.id ? (
                  /* ── Rename mode ── */
                  <div className="flex items-center gap-2">
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCommitRename(session.id);
                        if (e.key === "Escape") handleCancelRename();
                      }}
                      maxLength={80}
                      className="race-input flex-1 py-1 text-sm"
                      aria-label="Session name"
                      data-testid={`rename-input-${session.id}`}
                    />
                    <button
                      type="button"
                      onClick={() => handleCommitRename(session.id)}
                      className="inline-flex shrink-0 items-center justify-center rounded border border-race-blue-primary p-1 text-race-blue-primary transition-colors hover:bg-race-blue-primary hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--race-blue-primary)]"
                      aria-label="Save session name"
                      data-testid={`rename-save-${session.id}`}
                    >
                      {/* checkmark */}
                      <svg
                        className="size-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelRename}
                      className="inline-flex shrink-0 items-center justify-center rounded border border-race-line p-1 text-race-muted transition-colors hover:border-race-ink hover:text-race-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--race-blue-primary)]"
                      aria-label="Cancel rename"
                      data-testid={`rename-cancel-${session.id}`}
                    >
                      {/* ✕ */}
                      <svg
                        className="size-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                ) : (
                  /* ── Normal mode ── */
                  <div className="flex items-center gap-2">
                    {/* Session info — clicking switches to this session */}
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--race-blue-primary)]"
                      onClick={() => handleSwitchAndClose(session.id)}
                      aria-label={`${isActive ? "Current session:" : "Switch to"} ${session.name}`}
                      data-testid={`session-switch-${session.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm font-bold ${
                            isActive
                              ? "text-race-blue-primary"
                              : "text-race-ink"
                          }`}
                        >
                          {session.name}
                        </span>
                        {isActive && (
                          <span
                            className="shrink-0 border border-race-blue-primary px-1 text-[9px] font-black uppercase tracking-widest text-race-blue-primary"
                            aria-label="Active"
                          >
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-race-muted">
                          {session.mode === "stopwatch" ? "SW" : "TIMER"}
                        </span>
                        <span
                          className={`text-[10px] font-black uppercase tracking-wider ${
                            isRunning ? "text-race-red" : "text-race-muted"
                          }`}
                          aria-label={`Status: ${statusLabel}`}
                        >
                          {statusLabel}
                        </span>
                        <span className="text-[10px] text-race-muted">
                          {timeAgo(session.lastUsedAt)}
                        </span>
                      </div>
                    </button>

                    {/* Rename button */}
                    <button
                      type="button"
                      onClick={() => handleStartRename(session)}
                      className="inline-flex shrink-0 items-center justify-center rounded border border-race-line p-1 text-race-muted transition-colors hover:border-race-ink hover:text-race-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--race-blue-primary)]"
                      aria-label={`Rename "${session.name}"`}
                      data-testid={`rename-btn-${session.id}`}
                    >
                      <PencilIcon className="size-4" aria-hidden="true" />
                      <span className="sr-only">Rename session</span>
                    </button>

                    {/* Delete button / inline confirmation */}
                    {confirmingDeleteId === session.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="text-[10px] font-bold text-race-ink">
                          Delete?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteConfirm(session.id)}
                          className="border-2 border-race-red bg-race-red px-2 py-0.5 text-[10px] font-black uppercase text-white transition-colors hover:border-race-ink hover:bg-race-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--race-blue-primary)]"
                          aria-label={`Confirm delete "${session.name}"`}
                          data-testid={`confirm-delete-solo-${session.id}`}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="border-2 border-race-ink px-2 py-0.5 text-[10px] font-black uppercase text-race-ink transition-colors hover:bg-race-ink hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--race-blue-primary)]"
                          aria-label="Cancel delete"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingDeleteId(session.id);
                          setRenamingId(null);
                        }}
                        className="inline-flex shrink-0 items-center justify-center rounded border border-race-line p-1 text-race-muted transition-colors hover:border-race-red hover:text-race-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--race-blue-primary)]"
                        aria-label={`Delete "${session.name}"`}
                        data-testid={`delete-solo-btn-${session.id}`}
                      >
                        <TrashIcon className="size-4" aria-hidden="true" />
                        <span className="sr-only">Delete session</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Create new session ───────────────────────────────────────────── */}
        <div className="border-t-2 border-race-ink p-4">
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                ref={newNameInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                placeholder={`Session ${sessions.length + 1}`}
                maxLength={80}
                className="race-input flex-1 py-1 text-sm"
                aria-label="New session name"
                data-testid="new-session-name-input"
              />
              <button
                type="button"
                onClick={handleCreate}
                className="race-action shrink-0 px-3 py-1 text-xs"
                data-testid="create-session-confirm-btn"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="race-action race-action--outline shrink-0 px-3 py-1 text-xs"
              >
                Cancel
              </button>
            </div>
          ) : atCap ? (
            <p
              className="text-xs font-semibold text-race-muted"
              role="status"
              data-testid="session-cap-message"
            >
              Maximum {SESSION_CAP} sessions reached. Delete a session to create
              a new one.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="race-action w-full text-xs"
              data-testid="open-create-session-btn"
            >
              + New session
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
