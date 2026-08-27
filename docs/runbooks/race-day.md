# Race-Day Runbook

## Before Leaving

1. Confirm `https://splitsync.org` loads on mobile data.
2. Sign in as the event organizer on web and mobile tracker.
3. Confirm the event roster and every race assignment.
4. If volunteers are helping (scoring, check-in, officiating), open the event setup page's Volunteers section and generate one invite link per person with the role they need (see `apps/web/src/app/help/organizer/volunteers`). Have them accept it and confirm they can open the web scorer before race day.
5. Publish the event and open the event QR code.
6. Scan the QR code with a second phone; confirm public results load.
7. Charge the tracker phone and bring a backup battery.
8. Keep the tracker phone connected to the network when possible. Crossings queue if it drops.

## At The Event

1. Open the race in the web scorer or native tracker. Volunteer scorers use the web scorer with their invite-based sign-in; the mobile tracker remains owner-only for now.
2. Verify the bib grid matches the riders on the start line.
3. Start the race at the start gun. This locks the roster.
4. Tap each assigned bib once when that rider crosses the line.
5. Watch the pending-sync indicator. It should be zero when connected.
6. Use web scorer undo for an accidental crossing; soft deletion updates spectators immediately.
7. Finish the race only after the final crossing sequence is recorded.

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
