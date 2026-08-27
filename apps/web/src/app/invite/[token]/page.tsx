"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { RaceNav } from "@/components/RaceNav";
import type { EventMemberRole } from "@/lib/types";

interface InvitePreview {
  event_id: string;
  event_title: string;
  role: EventMemberRole;
  valid: boolean;
}

const roleCopy: Record<EventMemberRole, string> = {
  organizer: "manage the roster, races, and invites",
  scorer: "record crossings and start/finish races",
  checkin: "view the private roster before publish",
  official: "view the event without making changes",
};

export default function AcceptInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .rpc("preview_event_invite", { p_token: token })
      .then(({ data, error: rpcError }) => {
        if (rpcError || !data || !data.event_id) setError("This invite link is invalid.");
        else setPreview(data);
        setPreviewLoading(false);
      });
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("accept_event_invite", { p_token: token });
    setAccepting(false);
    if (rpcError) return setError(rpcError.message);
    if (preview) router.replace(`/event/${preview.event_id}`);
  };

  if (previewLoading || authLoading) {
    return <main className="race-page flex items-center justify-center text-race-muted">Loading…</main>;
  }

  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav />
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="race-panel p-5">
          <p className="race-kicker--muted">Volunteer invite</p>
          {!preview || !preview.valid ? (
            <>
              <h1 className="mt-1 text-2xl font-black uppercase">This invite is no longer valid</h1>
              <p className="mt-3 text-sm text-race-muted">The link may have expired or already been used. Ask the organizer to send a new one.</p>
            </>
          ) : (
            <>
              <h1 className="mt-1 text-2xl font-black uppercase">{preview.event_title}</h1>
              <p className="mt-3 text-sm text-race-muted">
                You&apos;ve been invited as <b className="text-race-ink uppercase">{preview.role}</b>. You&apos;ll be able to {roleCopy[preview.role]} for this event.
              </p>
              {error && <p className="mt-3 text-sm font-bold text-race-ink">{error}</p>}
              {user ? (
                <button onClick={accept} disabled={accepting} className="race-action--muted mt-5 disabled:opacity-50">
                  {accepting ? "Joining…" : `Accept as ${preview.role}`}
                </button>
              ) : (
                <>
                  <p className="mt-4 text-xs font-bold uppercase tracking-wide text-race-muted">Sign in to accept</p>
                  <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="race-action--muted mt-3 inline-block">
                    Sign in
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
