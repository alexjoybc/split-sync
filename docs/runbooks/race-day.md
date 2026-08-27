# Race-Day Runbook

## Before Leaving

1. Confirm `https://splitsync.org` loads on mobile data.
2. Sign in as the event organizer on web and mobile tracker.
3. Confirm the event roster and every race assignment.
4. If volunteers are helping (scoring, check-in, officiating), open the event setup page's Volunteers section and generate one invite link per person with the role they need (see `apps/web/src/app/help/organizer/volunteers`). Have them accept it and confirm they can open the web scorer or check-in section before race day.
5. Publish the event and open the event QR code.
6. Scan the QR code with a second phone; confirm public results load.
7. Charge the tracker phone and bring a backup battery.
8. Keep the tracker phone connected to the network when possible. Crossings queue if it drops.

## At The Event

1. As racers arrive, check them in from the event setup page's Check-in section (or have a check-in volunteer do it from their own phone/tablet). This works from any device with a browser — no app install needed.
2. Open each race's Start list (linked next to Score) to confirm entries and check-in status before the gun. Print it if you want a paper copy at the start line.
3. Open the race in the web scorer or native tracker. Volunteer scorers use the web scorer with their invite-based sign-in; the mobile tracker remains owner-only for now.
4. Verify the bib grid matches the riders on the start line.
5. Mark any no-show as **DNS** before the start — the tile stays visible but greys out and can't record crossings.
6. Start the race at the start gun. This locks the roster.
7. Tap each assigned bib once when that rider crosses the line.
8. Watch the pending-sync indicator. It should be zero when connected.
9. Use web scorer undo for an accidental crossing; soft deletion updates spectators immediately.
10. If a rider crashes, abandons, or is pulled from the race, mark them **DNF** or **DSQ** on the scorer screen — they stay on the live board with that badge instead of a misleading lap count.
11. Finish the race only after the final crossing sequence is recorded.
12. For a points race, nothing extra happens at the scorer screen — sprints and lap-gain bonuses score automatically from the crossings you're already recording. Watch the live board or announcer view to call out each sprint result to spectators as it appears.

## If Connectivity Fails

- Keep tapping: crossings are queued locally with their original timestamps.
- Do not reload or clear browser/app storage.
- Restore connectivity and keep the scorer open until the pending counter returns to zero.

## If A Finished Race Needs Correcting

- A race can only accept new crossings while it is active; a finished or not-yet-started race rejects crossing taps even if attempted.
- To fix a finished race (e.g. a missed or wrong crossing), tap "Reopen race" in the web scorer or tracker, enter a reason, and confirm. The race returns to active and its finish time clears.
- Make the correction (record the missing crossing, or undo an incorrect one), then finish the race again.
- Every reopen is timestamped with the reason and organizer in the race's audit log.

## After The Event

1. Open the public event results hub and validate the final order.
2. Preserve the public event URL for racers.
3. If a volunteer's help was one-off (guest scorer, day-of official), revoke their access in the Volunteers section.
4. Record workflow problems in a GitHub issue while details are fresh.
