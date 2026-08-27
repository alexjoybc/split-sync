"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { EventAccessRole } from "./types";

// Resolves what the signed-in user is allowed to do with one event: the
// literal owner, an accepted event_members role (#75), or no access.
export function useEventAccess(eventId: string | null | undefined, user: User | null) {
  const [role, setRole] = useState<EventAccessRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!eventId || !user) {
      setRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      supabase.from("events").select("owner_id").eq("id", eventId).maybeSingle(),
      supabase.from("event_members").select("role").eq("event_id", eventId).eq("user_id", user.id).maybeSingle(),
    ]).then(([eventResult, memberResult]) => {
      if (!active) return;
      if (eventResult.data?.owner_id === user.id) setRole("owner");
      else setRole(memberResult.data?.role ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [eventId, user]);

  return { role, loading };
}

export const canManageEvent = (role: EventAccessRole) => role === "owner" || role === "organizer";
export const canScore = (role: EventAccessRole) => role === "owner" || role === "organizer" || role === "scorer";
export const canCheckIn = (role: EventAccessRole) => role === "owner" || role === "organizer" || role === "checkin";
