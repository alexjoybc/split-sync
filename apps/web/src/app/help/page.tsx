import Link from "next/link";

export const metadata = {
  title: "Help — SplitSync",
  description: "Self-service help for spectators and organizers using SplitSync.",
};

export default function HelpPage() {
  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <header className="race-masthead">
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-4">
          <div>
            <p className="race-kicker--muted">Self-service docs</p>
            <h1 className="race-title">Help</h1>
          </div>
          <Link href="/" className="race-action--muted race-action--outline">
            Back home
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-10 px-4 pt-8 sm:px-6">
        <p className="text-sm font-bold text-zinc-600">
          SplitSync provides live situational awareness and unofficial results
          for grassroots velodrome and cyclocross racing. It is not an
          official certified timing system.
        </p>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">For spectators</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Following live results
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>No sign-in is required. Live and results pages are public and read-only.</li>
            <li>
              A <strong>live</strong> race board shows real-time laps, gaps, and
              positions as riders cross the line, updated automatically.
            </li>
            <li>
              A <strong>results</strong> page shows the classification after a
              race finishes.
            </li>
            <li>
              An <strong>announcer</strong> view (open a race&apos;s live board
              and switch to it, or visit <code>/announce/&lt;raceId&gt;</code>)
              gives a large-text, high-contrast layout for a race announcer or
              venue screen: current leader, latest crossings, and a bib/name
              rider lookup. Its <strong>TV mode</strong> auto-scrolls the full
              standings and suits an unattended screen.
            </li>
            <li>
              Positions and gaps are derived live from timing crossings and may
              be corrected as more crossings are recorded. Treat all results as
              unofficial.
            </li>
            <li>
              A finished race can briefly return to <strong>live</strong> if the
              organizer reopens it to fix a scoring mistake. Standings refresh
              automatically once it is corrected and finished again.
            </li>
            <li>
              Once an organizer reviews a finished race and publishes it, the
              board reads <strong>Final classification</strong> instead of
              &quot;live&quot; — still unofficial, but no longer expected to
              change. If the organizer later reopens a published race to fix
              something, the board instead reads{" "}
              <strong>Results under revision</strong> until it is published
              again.
            </li>
            <li>
              A rider marked <strong>DNS</strong> (did not start),{" "}
              <strong>DNF</strong> (did not finish), or <strong>DSQ</strong>{" "}
              (disqualified) by the organizer stays listed with that badge
              instead of a rank, rather than showing a misleading &quot;0
              laps&quot;.
            </li>
            <li>
              A <strong>points race</strong> shows a second board below the
              main classification: a sprint-lap banner when the field reaches
              a scoring sprint (the final sprint is called out separately, at
              double points), that sprint&apos;s own 1st&ndash;4th result, and
              a cumulative <strong>points classification</strong> ranked by
              total points, not laps. A rider who breaks away and completes
              an extra lap on the rest of the field also picks up a lap-gain
              bonus.
            </li>
            <li>
              A <strong>time trial</strong> live board replaces the lap-count
              standings with an elapsed-time view. The top hero shows the
              rider currently on course with a live elapsed timer and a
              progress bar relative to the best finished time so far. Once the
              reference time exists, the bar turns red when a rider goes over
              it. An <strong>Up Next</strong> queue lists the riders yet to
              start in bib order. Below that, the <strong>Results</strong>{" "}
              table ranks finishers by elapsed time ascending, with the leader
              highlighted in yellow and gap times shown for every other
              finisher. Riders with a{" "}
              <strong>Review</strong> badge had more than two crossings
              recorded — their best elapsed time is used but the organizer
              should verify the data. DNS/DNF/DSQ riders appear below the
              ranked finishers with their status badge.
            </li>
            <li>
              A red <strong>Penalty</strong> badge next to a rider&apos;s name
              means an official applied a time penalty, lap penalty, or
              relegation. Hover or tap the badge to see the reason. The
              rider&apos;s position and gap already reflect the penalty — the
              underlying crossing times are never changed.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">For organizers</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Setting up an event
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>Sign in with a magic link sent to your email — no password needed.</li>
            <li>
              Create an event once, then build its roster of participants.
              Races are created under an event and pull their entries from that
              same roster.
            </li>
            <li>
              For fields with many riders (like a CX event), use{" "}
              <strong>Import from CSV</strong> in the roster section instead of
              entering racers one at a time. Columns: <code>bib</code>,{" "}
              <code>first_name</code>/<code>last_name</code> (or a single{" "}
              <code>name</code> column), <code>team</code>,{" "}
              <code>category</code>, and optional <code>sex</code>. The
              preview shows which rows are ready and which are skipped
              (missing bib/name, duplicate bib in the file, or a bib already
              on the roster). You can optionally map each category in the
              file to an upcoming race so imported riders are assigned to
              their race in the same step. Day-of registrations can still be
              added one at a time with the regular add-racer form.
            </li>
            <li>
              Running a recurring series? Use <strong>Clone event</strong> on an
              existing event to start a new draft with the same details,
              categories, and race structure. Optionally include a copy of the
              participant roster. Cloning never copies race-day data — the new
              event starts as a draft with no entries, crossings, or results,
              and its races always start <strong>upcoming</strong>.
            </li>
            <li>
              Tap <strong>Assign</strong> on a race card to open its entry
              list. Search by bib, name, or category, or pick a category from
              the filter to narrow a large roster. Selecting a category also
              enables <strong>Assign all in [category]</strong> /{" "}
              <strong>Unassign all in [category]</strong> so you can put a
              whole field into a race in one action.
            </li>
            <li>
              A race can only be edited (name, entries) while it is
              <strong> upcoming</strong>. Starting a race locks its entry list.
            </li>
            <li>
              Publish an event before race day so spectators can find its live
              and results pages. Draft events are only visible to you.
            </li>
            <li>
              From your event setup page&apos;s <strong>Check-in</strong>{" "}
              section, tap <strong>Check in</strong> next to a racer as they
              arrive and collect their bib. Search or filter by category or
              check-in status to find them quickly on a busy morning. Check-in
              is per-event, so it applies across every race a racer is
              entered in.
            </li>
            <li>
              Each race has a <strong>Start list</strong> link (next to{" "}
              <strong>Score</strong>) showing its entries — bib, name, team,
              category, and check-in status — sorted by bib or category. Toggle{" "}
              <strong>Checked-in only</strong> to see just the racers ready to
              start, and use <strong>Print</strong> for a paper copy at the
              start line.
            </li>
            <li>
              To run a <strong>velodrome points race</strong>, check{" "}
              <strong>Points race</strong> when adding it (the &quot;Velodrome
              points race&quot; template turns this on by default) and set how
              many laps between sprints. Sprints are scored automatically from
              the same crossings you&apos;re already recording — there&apos;s
              nothing extra to tap at a sprint lap. The final lap is always a
              scoring sprint at double points, even if it doesn&apos;t land on
              your sprint interval.
            </li>
            <li>
              To run a <strong>time trial</strong>, check{" "}
              <strong>Time trial</strong> when adding the race (or use the
              &quot;Time trial&quot; template) and optionally set the{" "}
              <strong>countdown seconds</strong>. The scorer screen replaces
              the bib grid with a dedicated <strong>Up Next / On Course /
              Finished</strong> workflow:
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>
                  <strong>Up Next</strong> lists all riders who haven&apos;t
                  started yet, in natural bib order. The top entry is marked{" "}
                  <strong>NEXT</strong>.
                </li>
                <li>
                  To send a rider, tap <strong>Start now</strong> (immediate)
                  or <strong>Start countdown</strong> (visual + audible
                  countdown, cancelable). The countdown plays beep tones
                  through your device speaker and fires the start crossing
                  automatically at zero. If countdown seconds is set to 0,
                  only &quot;Start now&quot; is shown.
                </li>
                <li>
                  Only one rider can be on course at a time. While someone is
                  running, the start controls are hidden.
                </li>
                <li>
                  The <strong>On Course</strong> panel shows a live elapsed
                  timer and a progress bar against the current best time. When
                  the rider exceeds the best time, an &quot;over best&quot;
                  indicator appears. Tap <strong>Finish</strong> to record
                  their finish crossing.
                </li>
                <li>
                  <strong>Finished</strong> lists ranked results in most-recent
                  first order, with elapsed time and gap to leader.
                </li>
                <li>
                  DNS/DNF/DSQ riders are excluded from the queue but remain on
                  the live and results boards with their badge.
                </li>
                <li>
                  To correct a start or finish crossing, use{" "}
                  <strong>Undo</strong> in the recent crossings list below the
                  scorer — the rider returns to the appropriate state
                  immediately (to On Course if only start removed, to Up Next
                  if both removed).
                </li>
              </ul>
            </li>
            <li>
              For mass-start races, use the scorer screen to record crossings by
              tapping a rider&apos;s bib as they cross the line. Free-form bib
              entry is intentionally not supported — only assigned entries appear
              as tiles. For large fields, use the{" "}
              <strong>Find bib / rider</strong> search box above the grid to
              narrow the tiles to a matching bib number or name — the rest of
              the field is hidden while you search but their lap counts and
              state are unaffected. Clear the box to restore the full grid
              instantly.
            </li>
            <li>
              Crossings can only be recorded while a race is <strong>active</strong>.
              Tap <strong>Start race</strong> once riders are on the line, and{" "}
              <strong>Finish</strong> once the final crossing is recorded — this
              is enforced by the database, not just the screen.
            </li>
            <li>
              Finished a race too early, or need to add a missed crossing? Tap{" "}
              <strong>Reopen race</strong> on the finished race screen and enter
              a reason — this is required and kept in the race&apos;s audit
              history. Reopening clears the finish time and returns the race to
              active so you can correct it, then finish it again.
            </li>
            <li>
              Once a race finishes, tap <strong>Review &amp; publish</strong> to
              open a checklist before locking in results: riders with no
              crossings, unusually slow last laps (or, for a time trial, riders
              still on course or flagged for review), unresolved DNS/DNF/DSQ
              statuses, and any penalties applied. The checklist is advisory —
              SplitSync results stay unofficial either way — but tapping{" "}
              <strong>Finalize &amp; publish</strong> timestamps the race as
              final for spectators. Reopening a published race clears that
              timestamp and marks results{" "}
              <strong>under revision</strong> until you publish again.
            </li>
            <li>
              An accidental crossing can be removed without reopening: use{" "}
              <strong>Undo</strong> next to it in the scorer&apos;s recent list.
              This works whether the race is active or finished.
            </li>
            <li>
              Tapped the wrong bib, or the time looks off? Use{" "}
              <strong>Edit</strong> next to a recent crossing to correct its
              bib or time. A reason is required and is kept in the
              crossing&apos;s audit history; the crossing&apos;s identity
              (used for offline sync) is never changed, so standings update
              live from the correction.
            </li>
            <li>
              Undid a crossing by mistake? Find it under{" "}
              <strong>Recently removed</strong> below the recent list and tap{" "}
              <strong>Restore</strong>. A reason is required, same as editing.
            </li>
            <li>
              Mark a rider <strong>DNS</strong>, <strong>DNF</strong>, or{" "}
              <strong>DSQ</strong> from the rider detail sheet — tap the{" "}
              <strong>•••</strong> button on a rider&apos;s tile to open it.
              You can do this at any time: before the race starts (DNS),
              mid-race (DNF/DSQ), or even after it finishes to correct a
              mistake. Statused riders are excluded from ranked position on
              the live/results boards but stay visible with their badge, and
              can&apos;t record further crossings. You&apos;ll be asked for
              an optional reason, which is kept with the change.
            </li>
            <li>
              Tap <strong>•••</strong> on a rider&apos;s tile to open their
              detail sheet, then tap <strong>+ Add penalty</strong> to apply
              a <strong>time penalty</strong> (added seconds), a{" "}
              <strong>lap penalty</strong> (dropped laps), a{" "}
              <strong>relegation</strong>, or a plain <strong>note</strong> —
              a reason is required for every one. The penalty adjusts that
              rider&apos;s position and gap on the live/results boards without
              ever touching their recorded crossing times; spectators see a{" "}
              <strong>Penalty</strong> badge with the reason. A yellow
              penalty count badge on the rider&apos;s tile in the grid signals
              that penalties are active. Remove a mistaken entry with{" "}
              <strong>Remove</strong> inside the detail sheet.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">For organizers</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Volunteer roles &amp; invites
            </h2>
          </div>
          <p className="mt-4 text-sm font-semibold text-zinc-700">
            You don&apos;t have to run an event alone. From your event setup
            page&apos;s <strong>Volunteers</strong> section you can generate a
            single-use invite link for each helper and pick their role:
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li><strong>Organizer</strong> — everything you can do except delete the event: roster, races, publishing, and inviting/revoking other volunteers.</li>
            <li><strong>Scorer</strong> — records and undoes crossings, and starts/finishes races. Cannot edit the roster or event details.</li>
            <li><strong>Check-in</strong> — can view the private roster before publish and one-tap check racers in as they arrive, without being able to edit their bib, name, team, or category.</li>
            <li><strong>Official</strong> — can view the event, roster, races, and crossings, and is the only role (besides organizer) that can apply penalties and adjustments to a rider on the scorer screen. Cannot otherwise edit the roster, races, or crossings.</li>
          </ul>
          <p className="mt-4 text-sm font-semibold text-zinc-700">
            Send the generated link directly to that person (text, email,
            whatever&apos;s easiest) — generate one link per person rather
            than sharing a single link with a group. Links expire after 14
            days or as soon as they&apos;re used once. Revoking a volunteer or
            an unused invite in the Volunteers section takes effect
            immediately, at the database level, not just in the app.
          </p>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">Solo timer</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Using the stopwatch
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>
              The <Link href="/stopwatch" className="underline decoration-2 underline-offset-2 hover:text-race-red">solo stopwatch</Link>{" "}
              is available at <code>/stopwatch</code> — free, with no ads, no
              subscription, and no account required. It works fully offline; no
              data is sent to any server.
            </li>
            <li>
              Tap <strong>Start</strong> to begin timing, <strong>Stop</strong>{" "}
              to pause. Tap <strong>Reset</strong> while stopped to return to
              zero.
            </li>
            <li>
              <strong>Delayed start (optional):</strong> before starting, pick a
              countdown of <strong>3, 5, or 10 seconds</strong> (default is{" "}
              <strong>OFF</strong> for instant start). Tapping{" "}
              <strong>Start</strong> then shows a get-ready countdown before
              timing begins — handy for timing yourself. Tap{" "}
              <strong>Cancel</strong> during the countdown to abort without
              starting. Resuming after a Stop keeps your accumulated time
              either way.
            </li>
            <li>
              While running, tap <strong>Lap</strong> to record a split. Each
              lap shows its own duration and the cumulative time. The{" "}
              <strong>best (shortest) lap</strong> is highlighted in yellow.
              Laps are shown newest-first.
            </li>
            <li>
              Once you have two or more laps, a stats strip shows your{" "}
              <strong>best</strong>, <strong>worst</strong>, and{" "}
              <strong>average</strong> lap, plus a bar chart of lap-time trend.
            </li>
            <li>
              Keyboard shortcuts:{" "}
              <strong>Space</strong> = start / stop,{" "}
              <strong>L</strong> = lap.
            </li>
            <li>
              <strong>Sound cues</strong> are optional and off by default.
              Under the <strong>Sound</strong> section below the stopwatch,
              enable <strong>Beep on start / stop / lap</strong> for a short
              audible confirmation of each press. The beeps are synthesized in
              your browser — nothing is downloaded and no permission is needed.
              Your choice is remembered on this device.
            </li>
            <li>
              Enable the <strong>target-time beep</strong> and set a target
              (MM:SS) to hear a single distinct two-tone beep when the elapsed
              time reaches it. The stopwatch <strong>keeps running</strong> —
              once past the target, the time over it is shown in red below the
              dial so you can measure exactly how far you overran. Changing the
              target re-arms the beep.
            </li>
            <li>
              In the Android Stopwatch app, the same options live behind the{" "}
              <strong>♪</strong> button in the top bar — for both the solo
              stopwatch and shared sessions — and haptic feedback stays on
              regardless. Cues are guaranteed while the app is on screen; with
              the app backgrounded or the phone locked they are best-effort,
              as the system may pause the app&apos;s timers.
            </li>
            <li>
              Timing stays accurate while the tab is in the background — the
              stopwatch anchors to a monotonic clock ({"`"}
              performance.now(){"`"}), not accumulated intervals.
            </li>
            <li>
              Tap <strong>Large display</strong> to enlarge the timer so it is
              readable from a distance (the browser goes fullscreen where
              supported). Press <strong>Esc</strong> or tap{" "}
              <strong>Exit large display</strong> to return.
            </li>
            <li>
              While the stopwatch is running, the screen is kept awake in
              browsers that support the wake lock API — no need to fight the
              screen-off timeout during a long effort.
            </li>
            <li>
              Tap <strong>🔓</strong> to lock <strong>Stop</strong> and{" "}
              <strong>Reset</strong> against accidental taps —{" "}
              <strong>Lap</strong> keeps working while locked. Press and hold{" "}
              <strong>🔒</strong> for about 1.5 seconds to unlock.
            </li>
            <li>
              <strong>Your timer survives a page refresh.</strong> The running
              or stopped state, elapsed time, and all recorded laps are saved
              on this device and restored when the page reloads — a running
              timer keeps counting from a wall-clock anchor while the page is
              closed. Tap <strong>Reset</strong> to clear the saved state. The
              same applies in the SplitSync Stopwatch app: the solo timer is
              restored even if the app is killed or the phone reboots.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">Shared timing</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Time Together — shared sessions
            </h2>
          </div>
          <p className="mt-4 text-sm font-semibold text-zinc-700">
            The SplitSync Stopwatch app (Android) supports shared timing sessions
            — multiple devices timing the same activity in real time, all seeing
            the same clock and lap splits. Like the solo stopwatch, it is free
            with no ads and no subscription; only the person <em>creating</em> a
            session signs in, and everyone else joins with just a display name.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>
              <strong>Creating a session</strong> requires a SplitSync account.
              Sign in, then click <strong>Time together</strong> on the stopwatch
              page (web) or tap <strong>NEW SESSION</strong> in the app. Name the
              session, enter a display name for yourself, and share the link —
              joiners do <em>not</em> need an account.
            </li>
            <li>
              The share link looks like{" "}
              <code>https://splitsync.org/stopwatch/s/AB3K9X</code>. Send it to
              anyone at the other end of the course.
            </li>
            <li>
              <strong>Joining</strong> is frictionless — tap the link, enter a
              display name, and you&apos;re in. No sign-in required.
            </li>
            <li>
              Any participant can press <strong>START</strong>, <strong>LAP</strong>,
              or <strong>STOP</strong>. All devices share a server-anchored clock so
              everyone sees the same elapsed time.
            </li>
            <li>
              The <strong>lap table</strong> shows each split with the name of who
              pressed LAP. The <strong>participant strip</strong> shows who is in the
              session.
            </li>
            <li>
              Only the <strong>session creator</strong> (★) can Reset the clock.
            </li>
            <li>
              Sessions expire after 4 hours (extended by each lap, up to 16 hours).
              A stopped session cannot be resumed — create a new one.
            </li>
            <li>
              If you disconnect, the app catches up automatically — laps are never
              lost due to a brief connection drop.
            </li>
            <li>
              Signed-in users see their <strong>session history</strong> below the
              stopwatch and can rejoin or share past sessions at any time.
            </li>
            <li>
              While a stopwatch is running (solo or shared), the Android app
              shows an <strong>ongoing notification</strong> with the session
              name and the ticking elapsed time, so you can switch to other apps
              without losing sight of the clock. Tap it to return to the
              stopwatch; it disappears on stop or reset. The app asks for
              notification permission once — declining it never blocks timing
              and you won&apos;t be asked again.
            </li>
            <li>
              Rotate the phone to <strong>landscape</strong> for a larger
              display readable from a distance — the LCD digits grow to fill
              the width while the buttons and lap list stay usable. Works on
              both the shared session and solo stopwatch screens.
            </li>
            <li>
              Tap <strong>🔓</strong> to lock <strong>Stop</strong> and{" "}
              <strong>Reset</strong> against accidental taps —{" "}
              <strong>Lap</strong> keeps working while locked. Press and hold{" "}
              <strong>🔒</strong> for about 1.5 seconds to unlock. In shared
              sessions the lock is local to your device only; it never affects
              other participants.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">For mobile trackers</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Using the tracker app
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>
              The SplitSync tracker app records start/finish crossings with a
              single tap and works alongside this website.
            </li>
            <li>
              Tap a rider&apos;s tile on the scorer screen as they cross the
              line. The tile flashes red to confirm the recording.
            </li>
            <li>
              A <strong>Recent Crossings</strong> panel appears below the rider
              grid during an active race. It shows the last few crossings (bib
              and time). Tap <strong>UNDO</strong> next to any crossing to
              remove it immediately — this soft-deletes the crossing so it is
              excluded from lap counts and standings, matching the web
              scorer&apos;s behavior.
            </li>
            <li>
              Undo works whether the crossing has already synced to the server
              or is still pending in the offline queue. If the crossing hasn&apos;t
              synced yet (you&apos;re offline or the upload is still in progress),
              it is removed from the local queue directly — no round-trip needed.
            </li>
            <li>
              Undo on mobile is intended for immediate mis-tap correction. To
              restore a removed crossing, correct a bib or time, or manage older
              crossings, use the web scorer at splitsync.org — those tools require
              an audit reason and are kept in the crossing&apos;s history.
            </li>
            <li>
              For a <strong>time trial race</strong>, the tracker shows an{" "}
              <strong>Up Next / On Course / Finished</strong> workflow instead of the
              bib grid. Tap <strong>Start now</strong> to send the next rider
              immediately, or <strong>Start countdown</strong> for a haptic countdown
              before the start crossing fires automatically. Tap{" "}
              <strong>Finish</strong> when the rider crosses the finish line. Only one
              rider can be on course at a time.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
