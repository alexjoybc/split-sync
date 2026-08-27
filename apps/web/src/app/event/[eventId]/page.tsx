"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, PencilIcon, PlusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { canCheckIn, canManageEvent, canScore, useEventAccess } from "@/lib/useEventAccess";
import { RaceNav } from "@/components/RaceNav";
import { raceTemplates } from "@/lib/raceTemplates";
import type { Entry, EventInvite, EventMember, EventMemberRole, EventRow, Participant, Race, Sex } from "@/lib/types";

const roleOptions: { value: EventMemberRole; label: string; hint: string }[] = [
  { value: "organizer", label: "Organizer", hint: "Manages roster, races, and invites like the owner." },
  { value: "scorer", label: "Scorer", hint: "Records crossings and starts/finishes races." },
  { value: "checkin", label: "Check-in", hint: "Views the private roster before publish." },
  { value: "official", label: "Read-only official", hint: "Views everything, cannot make changes." },
];
const roleLabel = (role: EventMemberRole) => roleOptions.find((option) => option.value === role)?.label ?? role;

const categories = ["U13", "U15", "U17", "Junior", "U23", "Senior", "Master 35+", "Master 40+", "Master 50+", "Open"];
const sexOptions: { value: Sex; label: string }[] = [
  { value: "M", label: "M" },
  { value: "F", label: "F" },
  { value: "X", label: "X" },
];
const timezones = ["America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Toronto", "America/Halifax", "UTC"];
const inputCls = "race-input--muted";

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

interface EventDetailsForm {
  description: string;
  banner_image_url: string;
  venue_address: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  contact_email: string;
  registration_url: string;
}

const emptyDetails: EventDetailsForm = {
  description: "",
  banner_image_url: "",
  venue_address: "",
  starts_at: "",
  ends_at: "",
  timezone: "",
  contact_email: "",
  registration_url: "",
};

function fullName(person: { first_name: string; last_name: string | null }) {
  return [person.first_name, person.last_name].filter(Boolean).join(" ");
}

type RiderDraft = { bib: string; firstName: string; lastName: string; team: string; category: string; sex: Sex | "" };
const emptyDraft: RiderDraft = { bib: "", firstName: "", lastName: "", team: "", category: "", sex: "" };

export default function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const router = useRouter();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rider, setRider] = useState<RiderDraft>(emptyDraft);
  const [newRace, setNewRace] = useState({ name: "", laps: "" });
  const [newRaceTemplateId, setNewRaceTemplateId] = useState("");
  const [assigningRaceId, setAssigningRaceId] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [details, setDetails] = useState<EventDetailsForm>(emptyDetails);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<RiderDraft>(emptyDraft);
  const bibInputRef = useRef<HTMLInputElement>(null);
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useEventAccess(eventId, user);
  const manage = canManageEvent(role);
  const checkin = canCheckIn(role);
  const [members, setMembers] = useState<EventMember[]>([]);
  const [invites, setInvites] = useState<EventInvite[]>([]);
  const [inviteRole, setInviteRole] = useState<EventMemberRole>("scorer");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [checkinQuery, setCheckinQuery] = useState("");
  const [checkinCategory, setCheckinCategory] = useState("");
  const [checkinStatus, setCheckinStatus] = useState<"all" | "in" | "out">("all");
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);

  const refetchVolunteers = useCallback(async () => {
    if (!manage) return;
    const [ms, is] = await Promise.all([
      supabase.from("event_members").select("*").eq("event_id", eventId).order("created_at"),
      supabase.from("event_invites").select("*").eq("event_id", eventId).is("used_at", null).order("created_at", { ascending: false }),
    ]);
    if (ms.data) setMembers(ms.data);
    if (is.data) setInvites(is.data);
  }, [eventId, manage]);

  useEffect(() => { refetchVolunteers(); }, [refetchVolunteers]);

  const createInvite = async () => {
    if (!user) return;
    setCreatingInvite(true);
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { error } = await supabase.from("event_invites").insert({
      event_id: eventId,
      role: inviteRole,
      token,
      created_by: user.id,
    });
    setCreatingInvite(false);
    if (!error) refetchVolunteers();
  };

  const revokeInvite = async (invite: EventInvite) => {
    await supabase.from("event_invites").delete().eq("id", invite.id);
    refetchVolunteers();
  };

  const revokeMember = async (member: EventMember) => {
    await supabase.from("event_members").delete().eq("id", member.id);
    refetchVolunteers();
  };

  const copyInviteLink = async (invite: EventInvite) => {
    const link = `${origin}/invite/${invite.token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedInviteId(invite.id);
      setTimeout(() => setCopiedInviteId(null), 1500);
    } catch {
      window.prompt("Copy invite link", link);
    }
  };

  const [cloning, setCloning] = useState(false);
  const [cloneTitle, setCloneTitle] = useState("");
  const [cloneRoster, setCloneRoster] = useState(false);
  const [cloneSaving, setCloneSaving] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const [ev, rs, en, ps] = await Promise.all([
      supabase.from("events").select("*").eq("id", eventId).single(),
      supabase.from("races").select("*").eq("event_id", eventId).order("sequence_order"),
      supabase.from("entries").select("*"),
      supabase.from("participants").select("*").eq("event_id", eventId).order("bib"),
    ]);
    if (ev.data) setEvent(ev.data);
    if (rs.data) setRaces(rs.data);
    if (en.data && rs.data) setEntries(en.data.filter((entry) => rs.data.some((race) => race.id === entry.race_id)));
    if (ps.data) setParticipants(ps.data);
  }, [eventId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setEvent(null);
      setRaces([]);
      setEntries([]);
      setParticipants([]);
      return;
    }
    refetch();
  }, [refetch, authLoading, user]);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if (!event) return;
    setDetails({
      description: event.description ?? "",
      banner_image_url: event.banner_image_url ?? "",
      venue_address: event.venue_address ?? "",
      starts_at: toDatetimeLocal(event.starts_at),
      ends_at: toDatetimeLocal(event.ends_at),
      timezone: event.timezone ?? "",
      contact_email: event.contact_email ?? "",
      registration_url: event.registration_url ?? "",
    });
  }, [event]);

  const saveDetails = async () => {
    setSavingDetails(true);
    setDetailsSaved(false);
    const { error } = await supabase
      .from("events")
      .update({
        description: details.description.trim() || null,
        banner_image_url: details.banner_image_url.trim() || null,
        venue_address: details.venue_address.trim() || null,
        starts_at: fromDatetimeLocal(details.starts_at),
        ends_at: fromDatetimeLocal(details.ends_at),
        timezone: details.timezone.trim() || null,
        contact_email: details.contact_email.trim() || null,
        registration_url: details.registration_url.trim() || null,
      })
      .eq("id", eventId);
    setSavingDetails(false);
    if (!error) {
      setDetailsSaved(true);
      refetch();
    }
  };

  const addParticipant = async () => {
    if (!rider.bib.trim() || !rider.firstName.trim()) return;
    const { error } = await supabase.from("participants").insert({
      event_id: eventId,
      bib: rider.bib.trim(),
      first_name: rider.firstName.trim(),
      last_name: rider.lastName.trim() || null,
      team: rider.team.trim() || null,
      category: rider.category || null,
      sex: rider.sex || null,
    });
    if (!error) {
      setRider({ ...emptyDraft, category: rider.category, sex: rider.sex });
      refetch();
      bibInputRef.current?.focus();
    }
  };

  const removeParticipant = async (participant: Participant) => {
    await supabase.from("participants").delete().eq("id", participant.id);
    refetch();
  };

  const toggleCheckIn = async (participant: Participant) => {
    setCheckinBusyId(participant.id);
    const { error } = await supabase.rpc("set_participant_checked_in", {
      p_participant_id: participant.id,
      p_checked_in: !participant.checked_in_at,
    });
    setCheckinBusyId(null);
    if (!error) refetch();
  };

  const handleRiderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") addParticipant();
  };

  const startEdit = (participant: Participant) => {
    setEditingId(participant.id);
    setEditDraft({
      bib: participant.bib,
      firstName: participant.first_name,
      lastName: participant.last_name ?? "",
      team: participant.team ?? "",
      category: participant.category ?? "",
      sex: participant.sex ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(emptyDraft);
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft.bib.trim() || !editDraft.firstName.trim()) return;
    const { error } = await supabase
      .from("participants")
      .update({
        bib: editDraft.bib.trim(),
        first_name: editDraft.firstName.trim(),
        last_name: editDraft.lastName.trim() || null,
        team: editDraft.team.trim() || null,
        category: editDraft.category || null,
        sex: editDraft.sex || null,
      })
      .eq("id", editingId);
    if (!error) {
      cancelEdit();
      refetch();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") cancelEdit();
  };

  const addRace = async () => {
    if (!newRace.name.trim()) return;
    await supabase.from("races").insert({
      event_id: eventId,
      name: newRace.name.trim(),
      sequence_order: races.length + 1,
      laps_planned: newRace.laps ? parseInt(newRace.laps, 10) : null,
    });
    setNewRace({ name: "", laps: "" });
    setNewRaceTemplateId("");
    refetch();
  };

  const applyRaceTemplate = (templateId: string) => {
    setNewRaceTemplateId(templateId);
    const template = raceTemplates.find((t) => t.id === templateId);
    if (!template) return;
    setNewRace({ name: template.suggestedName, laps: template.defaultLaps ? String(template.defaultLaps) : "" });
  };

  const toggleAssignment = async (race: Race, participant: Participant, assigned: boolean) => {
    if (race.status !== "upcoming") return;
    if (assigned) {
      const existing = entries.find((entry) => entry.race_id === race.id && entry.bib === participant.bib);
      if (existing) await supabase.from("entries").delete().eq("id", existing.id);
    } else {
      await supabase.from("entries").insert({
        race_id: race.id,
        bib: participant.bib,
        name: fullName(participant),
        team: participant.team,
        category: participant.category,
      });
    }
    refetch();
  };

  const publish = async () => {
    await supabase.from("events").update({ status: "live" }).eq("id", eventId);
    refetch();
  };

  const checkinCategories = Array.from(new Set(participants.map((p) => p.category).filter(Boolean))) as string[];
  const checkedInCount = participants.filter((p) => p.checked_in_at).length;
  const checkinList = participants.filter((participant) => {
    if (checkinCategory && participant.category !== checkinCategory) return false;
    if (checkinStatus === "in" && !participant.checked_in_at) return false;
    if (checkinStatus === "out" && participant.checked_in_at) return false;
    if (checkinQuery.trim()) {
      const q = checkinQuery.trim().toLowerCase();
      const haystack = `${participant.bib} ${fullName(participant)} ${participant.team ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const openClone = () => {
    setCloneTitle(event ? `${event.title} (copy)` : "");
    setCloneRoster(false);
    setCloneError(null);
    setCloning(true);
  };

  const cloneEvent = async () => {
    setCloneSaving(true);
    setCloneError(null);
    const { data, error } = await supabase.rpc("clone_event", {
      p_event_id: eventId,
      p_include_roster: cloneRoster,
      p_title: cloneTitle.trim() || null,
    });
    setCloneSaving(false);
    if (error || !data) {
      setCloneError(error?.message ?? "Failed to clone event");
      return;
    }
    router.push(`/event/${data.id}`);
  };

  if (authLoading || roleLoading) return <main className="race-page flex items-center justify-center text-race-muted">Loading…</main>;
  if (!user || !role) return <main className="race-page"><div className="race-topline--muted" /><div className="mx-auto max-w-lg px-4 py-16"><div className="race-panel p-5"><p className="race-kicker--muted">Organizer access</p><h1 className="mt-1 text-2xl font-black uppercase">This event is private</h1><p className="mt-3 text-sm text-race-muted">Sign in with the organizer email, or use a volunteer invite link, to access this event.</p><Link href={`/login?next=${encodeURIComponent(`/event/${eventId}`)}`} className="race-action--muted mt-5 inline-block">Sign in</Link></div></div></main>;
  if (!event) return <main className="race-page flex items-center justify-center text-race-muted">Loading…</main>;

  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: `/results/${eventId}`, label: "Spectator results" }]} showAuth />
      <header className="race-masthead"><div className="mx-auto flex max-w-3xl items-end justify-between gap-4"><div><p className="race-kicker--muted">Event setup{role && role !== "owner" && ` · Signed in as ${roleLabel(role)}`}</p><h1 className="race-title">{event.title}</h1><p className="mt-1 text-xs font-bold uppercase tracking-wide text-race-muted">{event.location}</p></div>{manage && <button onClick={openClone} className="race-action--muted race-action--outline shrink-0">Clone event</button>}</div></header>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">

      {!manage && <section className="race-panel mt-8 p-4"><p className="race-kicker--muted">Volunteer access</p><p className="mt-1 text-sm text-race-muted">You have <b>{roleLabel(role)}</b> access to this event. {canScore(role) ? "Open a race below to score it." : checkin ? "Use the Check-in section below to confirm racers as they arrive." : "Roster and race setup are read-only for your role."}</p></section>}

      {manage && cloning && (
        <section className="race-panel mt-8 p-4">
          <p className="race-kicker--muted">Clone event</p>
          <p className="mt-2 text-sm text-race-muted">
            Creates a new draft event with the same details, categories, and race structure. Race-day data
            (entries, crossings, race status) is never copied — new races always start upcoming.
          </p>
          <div className="mt-3">
            <label className="block text-xs font-black uppercase tracking-wide">New event title</label>
            <input value={cloneTitle} onChange={(e) => setCloneTitle(e.target.value)} className={`mt-1 ${inputCls}`} />
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={cloneRoster} onChange={(e) => setCloneRoster(e.target.checked)} className="size-4 border-2 border-race-ink accent-race-ink" />
            <span className="text-sm font-bold">Include participant roster</span>
          </label>
          {cloneError && <p className="mt-2 text-sm font-bold text-race-red">{cloneError}</p>}
          <div className="mt-3 flex gap-3">
            <button onClick={cloneEvent} disabled={cloneSaving || !cloneTitle.trim()} className="race-action--muted race-action--yellow disabled:opacity-40">
              {cloneSaving ? "Cloning…" : "Confirm clone"}
            </button>
            <button onClick={() => { setCloning(false); setCloneError(null); }} className="text-sm font-black uppercase text-race-ink underline decoration-2 underline-offset-4">
              Cancel
            </button>
          </div>
        </section>
      )}

      {manage && <section className="race-panel mt-8 p-4">
        <div className="flex items-baseline justify-between"><h2 className="text-base font-black uppercase">1. Event details</h2>{detailsSaved && <span className="text-xs font-bold text-race-muted">Saved</span>}</div>
        <p className="mt-1 text-sm text-race-muted">Shown to spectators on the results page and shared with anyone you invite.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-black uppercase tracking-wide">Description</label>
            <textarea value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} placeholder="What racers and spectators should know about this event." rows={3} className={`mt-1 ${inputCls}`} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-black uppercase tracking-wide">Banner image URL</label>
            <input value={details.banner_image_url} onChange={(e) => setDetails({ ...details, banner_image_url: e.target.value })} placeholder="https://…" className={`mt-1 ${inputCls}`} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-black uppercase tracking-wide">Venue address</label>
            <input value={details.venue_address} onChange={(e) => setDetails({ ...details, venue_address: e.target.value })} placeholder="1234 Track Rd, Victoria, BC" className={`mt-1 ${inputCls}`} />
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-wide">Starts</label>
            <input type="datetime-local" value={details.starts_at} onChange={(e) => setDetails({ ...details, starts_at: e.target.value })} className={`mt-1 ${inputCls}`} />
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-wide">Ends</label>
            <input type="datetime-local" value={details.ends_at} onChange={(e) => setDetails({ ...details, ends_at: e.target.value })} className={`mt-1 ${inputCls}`} />
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-wide">Timezone</label>
            <input value={details.timezone} onChange={(e) => setDetails({ ...details, timezone: e.target.value })} placeholder="America/Vancouver" list="timezones" className={`mt-1 ${inputCls}`} />
            <datalist id="timezones">{timezones.map((tz) => <option key={tz} value={tz} />)}</datalist>
          </div>
          <div>
            <label className="block text-xs font-black uppercase tracking-wide">Contact email</label>
            <input type="email" value={details.contact_email} onChange={(e) => setDetails({ ...details, contact_email: e.target.value })} placeholder="organizer@example.com" className={`mt-1 ${inputCls}`} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-black uppercase tracking-wide">Registration link</label>
            <input value={details.registration_url} onChange={(e) => setDetails({ ...details, registration_url: e.target.value })} placeholder="https://zone4.ca/…" className={`mt-1 ${inputCls}`} />
          </div>
        </div>
        <button onClick={saveDetails} disabled={savingDetails} className="race-action--muted mt-4 disabled:opacity-50">{savingDetails ? "Saving…" : "Save details"}</button>
      </section>}

      {manage && <section className="race-panel mt-6 p-4">
        <div className="flex items-baseline justify-between"><h2 className="text-base font-black uppercase">2. Event roster</h2><span className="text-sm font-bold text-race-muted">{participants.length} racers</span></div>
        <p className="mt-1 text-sm text-race-muted">Add each racer once, then place them in one or more races below.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[80px_1fr_1fr_1fr_150px_72px_auto]">
          <input ref={bibInputRef} value={rider.bib} onChange={(e) => setRider({ ...rider, bib: e.target.value })} onKeyDown={handleRiderKeyDown} placeholder="Bib" inputMode="numeric" className={inputCls} />
          <input value={rider.firstName} onChange={(e) => setRider({ ...rider, firstName: e.target.value })} onKeyDown={handleRiderKeyDown} placeholder="First name" className={inputCls} />
          <input value={rider.lastName} onChange={(e) => setRider({ ...rider, lastName: e.target.value })} onKeyDown={handleRiderKeyDown} placeholder="Last name" className={inputCls} />
          <input value={rider.team} onChange={(e) => setRider({ ...rider, team: e.target.value })} onKeyDown={handleRiderKeyDown} placeholder="Team / club" className={inputCls} />
          <input value={rider.category} onChange={(e) => setRider({ ...rider, category: e.target.value })} onKeyDown={handleRiderKeyDown} placeholder="Category" list="categories" className={inputCls} />
          <select value={rider.sex} onChange={(e) => setRider({ ...rider, sex: e.target.value as Sex | "" })} className={inputCls}>
            <option value="">Sex</option>
            {sexOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button onClick={addParticipant} className="race-action--muted flex items-center justify-center"><PlusIcon className="size-5" /></button>
        </div>
        <datalist id="categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>

        {participants.length > 0 && (
          <div className="mt-4 overflow-hidden border-t-2 border-race-ink">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left text-[10px] font-black uppercase tracking-wide text-race-muted">
                  <th className="w-14 py-2">Bib</th>
                  <th className="py-2">First</th>
                  <th className="py-2">Last</th>
                  <th className="w-28 py-2">Team</th>
                  <th className="w-24 py-2">Category</th>
                  <th className="w-12 py-2">Sex</th>
                  <th className="w-16 py-2" />
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => {
                  const editing = editingId === participant.id;
                  if (editing) {
                    return (
                      <tr key={participant.id} className="border-b border-zinc-200 even:bg-race-panel-alt">
                        <td className="py-1 pr-1"><input value={editDraft.bib} onChange={(e) => setEditDraft({ ...editDraft, bib: e.target.value })} onKeyDown={handleEditKeyDown} inputMode="numeric" className={`${inputCls} !py-1`} /></td>
                        <td className="py-1 pr-1"><input value={editDraft.firstName} onChange={(e) => setEditDraft({ ...editDraft, firstName: e.target.value })} onKeyDown={handleEditKeyDown} className={`${inputCls} !py-1`} /></td>
                        <td className="py-1 pr-1"><input value={editDraft.lastName} onChange={(e) => setEditDraft({ ...editDraft, lastName: e.target.value })} onKeyDown={handleEditKeyDown} className={`${inputCls} !py-1`} /></td>
                        <td className="py-1 pr-1"><input value={editDraft.team} onChange={(e) => setEditDraft({ ...editDraft, team: e.target.value })} onKeyDown={handleEditKeyDown} className={`${inputCls} !py-1`} /></td>
                        <td className="py-1 pr-1"><input value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} onKeyDown={handleEditKeyDown} list="categories" className={`${inputCls} !py-1`} /></td>
                        <td className="py-1 pr-1">
                          <select value={editDraft.sex} onChange={(e) => setEditDraft({ ...editDraft, sex: e.target.value as Sex | "" })} className={`${inputCls} !py-1`}>
                            <option value="">—</option>
                            {sexOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </td>
                        <td className="py-1 text-right whitespace-nowrap">
                          <button onClick={saveEdit} aria-label="Save" className="text-race-muted hover:text-race-ink"><CheckIcon className="size-4" /></button>
                          <button onClick={cancelEdit} aria-label="Cancel" className="ml-2 text-race-muted hover:text-race-ink"><XMarkIcon className="size-4" /></button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={participant.id} className="border-b border-zinc-200 even:bg-race-panel-alt">
                      <td className="py-2 font-black tabular-nums">#{participant.bib}</td>
                      <td className="truncate py-2 font-bold">{participant.first_name}</td>
                      <td className="truncate py-2 font-bold">{participant.last_name ?? "—"}</td>
                      <td className="truncate py-2 text-race-muted">{participant.team ?? "—"}</td>
                      <td className="truncate py-2 text-race-muted">{participant.category ?? "—"}</td>
                      <td className="py-2 text-race-muted">{participant.sex ?? "—"}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button onClick={() => startEdit(participant)} aria-label={`Edit #${participant.bib} ${fullName(participant)}`} className="text-race-muted hover:text-race-ink"><PencilIcon className="size-4" /></button>
                        <button onClick={() => removeParticipant(participant)} aria-label={`Remove #${participant.bib} ${fullName(participant)}`} className="ml-2 text-race-muted hover:text-race-ink"><XMarkIcon className="size-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {checkin && <section className="race-panel mt-6 p-4">
        <div className="flex items-baseline justify-between"><h2 className="text-base font-black uppercase">3. Check-in</h2><span className="text-sm font-bold text-race-muted">{checkedInCount} / {participants.length} checked in</span></div>
        <p className="mt-1 text-sm text-race-muted">One tap to confirm a racer has arrived and collected their bib.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_150px]">
          <input value={checkinQuery} onChange={(e) => setCheckinQuery(e.target.value)} placeholder="Search bib, name, or team" className={inputCls} />
          <select value={checkinCategory} onChange={(e) => setCheckinCategory(e.target.value)} className={inputCls}>
            <option value="">All categories</option>
            {checkinCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={checkinStatus} onChange={(e) => setCheckinStatus(e.target.value as "all" | "in" | "out")} className={inputCls}>
            <option value="all">All riders</option>
            <option value="in">Checked in</option>
            <option value="out">Not checked in</option>
          </select>
        </div>

        {participants.length === 0 && <p className="mt-4 text-sm text-race-muted">Add racers to the roster before check-in opens.</p>}
        {participants.length > 0 && checkinList.length === 0 && <p className="mt-4 text-sm text-race-muted">No racers match this search or filter.</p>}

        {checkinList.length > 0 && (
          <div className="mt-4 overflow-hidden border-t-2 border-race-ink">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left text-[10px] font-black uppercase tracking-wide text-race-muted">
                  <th className="w-14 py-2">Bib</th>
                  <th className="py-2">Name</th>
                  <th className="w-28 py-2">Team</th>
                  <th className="w-24 py-2">Category</th>
                  <th className="w-28 py-2">Status</th>
                  <th className="w-24 py-2" />
                </tr>
              </thead>
              <tbody>
                {checkinList.map((participant) => (
                  <tr key={participant.id} className="border-b border-zinc-200 even:bg-race-panel-alt">
                    <td className="py-2 font-black tabular-nums">#{participant.bib}</td>
                    <td className="truncate py-2 font-bold">{fullName(participant)}</td>
                    <td className="truncate py-2 text-race-muted">{participant.team ?? "—"}</td>
                    <td className="truncate py-2 text-race-muted">{participant.category ?? "—"}</td>
                    <td className="py-2">
                      {participant.checked_in_at ? (
                        <span className="bg-race-yellow px-2 py-0.5 text-xs font-black uppercase text-race-ink">Checked in</span>
                      ) : (
                        <span className="bg-race-panel-alt px-2 py-0.5 text-xs font-black uppercase text-race-muted">Not in</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => toggleCheckIn(participant)}
                        disabled={checkinBusyId === participant.id}
                        className="race-action--muted disabled:opacity-50"
                      >
                        {participant.checked_in_at ? "Undo" : "Check in"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      <section className="mt-6">
        <div className="race-section-heading flex items-baseline justify-between"><h2 className="text-base font-black uppercase">4. Races</h2><span className="text-sm font-bold text-race-muted">{manage ? "Create then assign racers" : "Open a race to score it"}</span></div>
        <div className="mt-3 space-y-3">
          {races.map((race) => {
            const raceEntries = entries.filter((entry) => entry.race_id === race.id);
            const open = assigningRaceId === race.id;
            return <section key={race.id} className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800/75 dark:inset-ring dark:inset-ring-white/10">
              <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-gray-900 dark:text-white">{race.name}</h3><p className="text-xs text-gray-500 dark:text-gray-400">{race.laps_planned ? `${race.laps_planned} laps` : "open-ended"} · {raceEntries.length} racers · {race.status}</p></div><div className="flex gap-2">{manage && (race.status === "upcoming" ? <button onClick={() => setAssigningRaceId(open ? null : race.id)} className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:inset-ring-white/15">Assign</button> : <span className="px-2 py-2 text-xs font-black uppercase text-race-muted">Roster locked</span>)}{role && <Link href={`/startlist/${race.id}`} className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:inset-ring-white/15">Start list</Link>}{canScore(role) && <Link href={`/score/${race.id}`} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 dark:bg-indigo-500">Score</Link>}</div></div>
              {open && <div className="mt-4 grid gap-1 border-t border-gray-200 pt-3 dark:border-white/10 sm:grid-cols-2">{participants.map((participant) => { const assigned = raceEntries.some((entry) => entry.bib === participant.bib); return <label key={participant.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-gray-50 dark:hover:bg-white/5"><input type="checkbox" checked={assigned} onChange={() => toggleAssignment(race, participant, assigned)} className="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600" /><span className="text-sm text-gray-900 dark:text-white"><b>#{participant.bib}</b> {fullName(participant)}</span>{participant.category && <span className="ml-auto text-xs text-gray-500">{participant.category}</span>}</label>; })}</div>}
              {raceEntries.length > 0 && !open && <div className="mt-3 flex flex-wrap gap-1.5">{raceEntries.map((entry) => <span key={entry.id} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-300"><b>#{entry.bib}</b> {entry.name}{entry.status !== "ok" && <b className="ml-1 uppercase text-race-red">{entry.status}</b>}</span>)}</div>}
            </section>;
          })}
          {manage && <section className="rounded-lg border-2 border-dashed border-gray-300 p-4 dark:border-white/15">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Add race</h3>
            <div className="mt-2">
              <label className="block text-xs font-black uppercase tracking-wide text-race-muted">Template (optional)</label>
              <select value={newRaceTemplateId} onChange={(e) => applyRaceTemplate(e.target.value)} className={`mt-1 ${inputCls}`}>
                <option value="">No template — custom race</option>
                {raceTemplates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
              </select>
              {newRaceTemplateId && (() => {
                const template = raceTemplates.find((t) => t.id === newRaceTemplateId);
                if (!template) return null;
                return (
                  <p className="mt-1 text-xs text-race-muted">
                    {template.description} Suggested categories: {template.suggestedCategories.join(", ")}
                    {template.suggestedDurationMinutes ? ` · ~${template.suggestedDurationMinutes} min` : ""}.
                  </p>
                );
              })()}
            </div>
            <div className="mt-2 flex gap-2"><input value={newRace.name} onChange={(e) => setNewRace({ ...newRace, name: e.target.value })} placeholder="Race name" className={inputCls} /><input value={newRace.laps} onChange={(e) => setNewRace({ ...newRace, laps: e.target.value.replace(/\D/g, "") })} placeholder="Laps" inputMode="numeric" className={`${inputCls} !w-20`} /><button onClick={addRace} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 dark:bg-indigo-500">Add</button></div>
          </section>}
        </div>
      </section>

      {manage && <section className="race-panel mt-6 p-4">
        <div className="flex items-baseline justify-between"><h2 className="text-base font-black uppercase">5. Volunteers</h2><span className="text-sm font-bold text-race-muted">{members.length} active</span></div>
        <p className="mt-1 text-sm text-race-muted">Generate a role-scoped invite link for people helping you run the event. <Link href="/help" className="underline decoration-2 underline-offset-4">What can each role do?</Link></p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-black uppercase tracking-wide">Role</label>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as EventMemberRole)} className={`mt-1 ${inputCls}`}>
              {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <button onClick={createInvite} disabled={creatingInvite} className="race-action--muted disabled:opacity-50">{creatingInvite ? "Generating…" : "Generate invite link"}</button>
        </div>
        <p className="mt-1 text-xs text-race-muted">{roleOptions.find((option) => option.value === inviteRole)?.hint} Links expire after 14 days or first use.</p>

        {invites.length > 0 && (
          <ul className="mt-4 divide-y divide-zinc-300 border-y-2 border-race-ink">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><span className="bg-race-yellow px-2 py-0.5 text-xs font-black uppercase">{roleLabel(invite.role)}</span> <span className="ml-2 break-all text-xs text-race-muted">{origin}/invite/{invite.token}</span></span>
                <span className="flex gap-3 text-xs font-black uppercase">
                  <button onClick={() => copyInviteLink(invite)} className="text-race-ink underline decoration-2 underline-offset-4">{copiedInviteId === invite.id ? "Copied" : "Copy link"}</button>
                  <button onClick={() => revokeInvite(invite)} className="text-race-muted hover:text-race-ink">Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {members.length > 0 && (
          <ul className="mt-4 divide-y divide-zinc-300 border-y-2 border-race-ink">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span><span className="bg-race-panel-alt px-2 py-0.5 text-xs font-black uppercase">{roleLabel(member.role)}</span> <span className="ml-2 text-xs text-race-muted">{member.user_id}</span></span>
                <button onClick={() => revokeMember(member)} className="text-xs font-black uppercase text-race-muted hover:text-race-ink">Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </section>}

      {manage && <section className="race-panel mt-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="race-kicker--muted">6. Publish</p><h2 className="mt-1 text-base font-black uppercase">Spectator sharing</h2><p className="mt-1 text-sm text-race-muted">Publish once, then print or display this event QR code. Spectators choose their race from the results page.</p></div>{event.status === "live" ? <span className="bg-race-yellow px-3 py-2 text-xs font-black uppercase">Published</span> : <button onClick={publish} className="race-action--muted">Publish event</button>}</div>
        {event.status === "live" && origin && <div className="mt-5 border-2 border-race-ink bg-race-paper p-4"><div className="flex flex-wrap items-center gap-5">{(() => { const resultsUrl = `${origin}/results/${eventId}`; return <><QRCodeSVG value={resultsUrl} size={136} bgColor="#f4f1ea" fgColor="#18181b" /><div className="min-w-0"><p className="text-lg font-black uppercase">Event results QR</p><p className="mt-1 max-w-md text-sm text-race-muted">One link for every live race and finished classification at this event.</p><p className="mt-3 break-all text-[10px] font-bold text-race-muted">{resultsUrl}</p><a href={resultsUrl} target="_blank" className="mt-3 inline-block text-xs font-black uppercase text-race-ink underline decoration-2 underline-offset-4">Open spectator results ↗</a></div></>; })()}</div></div>}
      </section>}
      </div>
    </main>
  );
}
