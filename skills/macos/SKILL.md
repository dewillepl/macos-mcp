---
name: macos
description: Read or change native macOS apps from the shell — Reminders, Calendar, Notes, Mail, Messages/iMessage, Contacts. Fire whenever a request names or implies one: "remind me to", "what's on my calendar", "text X", "any mail from Y", "make a note", "complete a reminder", "add an event", or resolve a phone number or email address to a contact name.
---

# macOS app control

Drives the native macOS apps through three bridges:

| Bridge | Apps | Why this one |
|---|---|---|
| `EventKitCLI` (Swift binary) | Reminders, Calendar | EventKit is the only API with full read/write on both |
| JXA via `osascript` | Notes, Contacts, Mail writes, Messages send | Apple Events is the only thing that triggers a write |
| `sqlite3` direct reads | Mail, Messages | JXA Messages reads return nothing on Sonoma and later; JXA Mail reads time out at 60s on a real inbox |

Same primitives the `mcp-macos` MCP server uses. This skill calls them directly, so no tool schemas sit in context until something triggers the skill.

## Setup check

Run once per session if anything fails:

```bash
ls -lL ~/.local/bin/EventKitCLI   # -L follows the symlink
```

⚠️ **Check the link TARGET, not just its presence.** A dangling symlink passes `command -v` and then fails at exit 127. Verify with `ls -lL` or `readlink`. If the target is gone, re-vendor the binary:

```bash
cd "$(mktemp -d)" && npm i mcp-macos --no-save \
  && mkdir -p ~/.local/lib/mcp-macos/bin \
  && cp node_modules/mcp-macos/bin/EventKitCLI ~/.local/lib/mcp-macos/bin/EventKitCLI \
  && ln -sf ~/.local/lib/mcp-macos/bin/EventKitCLI ~/.local/bin/EventKitCLI
```

Do not point the link at an npm cache path (`~/.npm/_npx/...`). npm prunes it.

## Permissions

| Bridge | System Settings | Failure looks like |
|---|---|---|
| EventKitCLI Reminders | Privacy & Security → **Reminders** (full access) | `{"status":"error"}` with a permission message |
| EventKitCLI Calendar | Privacy & Security → **Calendars** (full access) | same |
| JXA Notes / Contacts / Mail / Messages | Privacy & Security → **Automation** → the app | `osascript` hangs, or "Not authorized to send Apple events" |
| sqlite3 Mail / Messages | Privacy & Security → **Full Disk Access** on your terminal | `unable to open database file` |

Full Disk Access is granted to the *terminal binary*, not to `sqlite3`. Version manager users need the real node binary, not the shim.

Verify JXA quickly:

```bash
osascript -l JavaScript -e 'Application("Contacts").people().length'
osascript -l JavaScript -e 'Application("Notes").notes().length'
```

Each should return a number. A hang means the permission dialog is trying and failing to appear.

## Reminders

All output is JSON: `{"status":"success","result":...}` or `{"status":"error","message":...}`, exit 1 on error.

```bash
# Read all open reminders
EventKitCLI --action read --showCompleted false

# Server-side filters: --filterList "<name>"  --search "<term>"
#   --dueWithin overdue|today|tomorrow|this-week|no-date
EventKitCLI --action read --showCompleted false --dueWithin today

# Create (--title required). Dates: "YYYY-MM-DD HH:mm:ss" is local time.
# Append Z or an offset for an explicit zone. A bare date makes it all-day.
EventKitCLI --action create --title "Buy milk" --targetList "Groceries" \
  --note "2% organic" --dueDate "2026-06-25 17:00:00"

# Update (--id required; only supplied fields change)
EventKitCLI --action update --id "<id>" --isCompleted true
EventKitCLI --action update --id "<id>" --title "New title" --dueDate "2026-06-26 09:00:00"

# Delete
EventKitCLI --action delete --id "<id>"

# Lists
EventKitCLI --action read-lists
EventKitCLI --action create-list --name "New List"
EventKitCLI --action update-list --name "Old" --newName "New"
EventKitCLI --action delete-list --name "List To Delete"
```

## Calendar

⚠️ **Always pass a bounded date range on reads.** The EventKit predicate cannot span more than 4 years, and omitting the dates returns nothing useful.

```bash
EventKitCLI --action read-events \
  --startDate "2026-06-01 00:00:00" --endDate "2026-07-01 00:00:00"
# optional: --filterCalendar "Work"  --search "standup"

EventKitCLI --action read-calendars

# Create (--title, --startDate, --endDate required)
EventKitCLI --action create-event --title "Team sync" \
  --startDate "2026-06-20 10:00:00" --endDate "2026-06-20 11:00:00" \
  --targetCalendar "Work" --location "Zoom" --notes "Agenda in Notes" \
  --url "https://example.com/room"

# Recurrence: --recurrence daily|weekly|monthly|yearly
#   --recurrenceInterval N   and EITHER --recurrenceEnd "<date>" OR --recurrenceCount N
EventKitCLI --action create-event --title "Standup" \
  --startDate "2026-06-23 09:00:00" --endDate "2026-06-23 09:15:00" \
  --recurrence weekly --recurrenceInterval 1 --recurrenceCount 12

# Update (--id required; --url "" clears the URL)
EventKitCLI --action update-event --id "<id>" --location "Room 2"

# Delete removes the single occurrence, not the series
EventKitCLI --action delete-event --id "<id>"
```

`findEventById` needs the same bounded range. An unbounded lookup returns 0 events even when the event exists.

## Notes, Contacts, Mail, Messages

Recipes live in the reference files. Read the one you need before writing any JXA or SQL, because both bridges have failure modes that look like success:

- **[references/notes-contacts.md](references/notes-contacts.md)** — Notes CRUD and folders, Contacts CRUD and search, and the phone/email to name enrichment cache.
- **[references/mail-messages.md](references/mail-messages.md)** — Messages reads from `chat.db`, Mail reads from the `Envelope Index` including the Gmail label join, Mail drafts and Messages send via JXA.

## Safety

- **A draft is not a send.** Building a Mail draft is reversible. Sending is not. Do not send mail on a user's behalf without an explicit instruction for that message.
- **iMessage send is immediate and outward-facing.** There is no draft state and no undo. Confirm the recipient and the text before calling it.
- **Deleting a note moves it to Recently Deleted; deleting a reminder or event does not.** EventKit deletes are permanent.
- **Mail's outgoing message list is shared across every process on the machine.** Never bulk-close or bulk-delete it. Target one message by identity.
- **Verify a write by reading it back.** JXA reports success on writes that did not land, in both directions. A read-back is the only evidence.
