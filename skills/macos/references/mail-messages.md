# Mail and Messages: SQLite reads, JXA writes

Reads go through `sqlite3` against the local Apple databases. Writes go through JXA, because Apple Events is the only API that triggers them. Both databases need Full Disk Access on the terminal binary.

## MESSAGES: reads from `~/Library/Messages/chat.db`

Timestamps: `date` is **nanoseconds since 2001-01-01**. Convert from Unix ms: `appleNanos = (unixMs - 978307200000) * 1e6`. To inject a date floor: `AND m.date >= <appleNanos>`.

When `m.text` is NULL the body is in the `attributedBody` NSKeyedArchiver blob. Select `hex(m.attributedBody)` and look for the `NSString` marker; text starts after the `0x2B` byte + a length byte, runs UTF-8 until a `0x86`/`0x84` control byte. If empty and `attachment_count > 0`, treat as `[Attachment]`.

### Read a thread by chat guid (newest first; reverse for chronological)
```bash
DB=~/Library/Messages/chat.db
/usr/bin/sqlite3 -json -readonly "$DB" "
  SELECT m.ROWID, m.text, m.is_from_me, m.date, COALESCE(h.id,'') as handle_id,
         hex(m.attributedBody) as attributedBody_hex,
         (SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID) as attachment_count
  FROM message m
  LEFT JOIN handle h ON m.handle_id = h.ROWID
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON c.ROWID = cmj.chat_id
  WHERE c.guid = 'iMessage;-;+15551234567'
  ORDER BY m.date DESC LIMIT 50 OFFSET 0"
```
A chat guid looks like `iMessage;-;+15551234567` or `iMessage;-;name@example.com` (group chats have a longer guid, so get it from "list chats" below).

### List chats (last message + participants; non-empty only)
```bash
/usr/bin/sqlite3 -json -readonly "$DB" "
  SELECT c.guid as chat_guid, COALESCE(c.display_name,'') as display_name,
    (SELECT GROUP_CONCAT(h.id, ', ') FROM chat_handle_join chj JOIN handle h ON h.ROWID=chj.handle_id WHERE chj.chat_id=c.ROWID) as participants,
    (SELECT m.text FROM message m JOIN chat_message_join cmj ON cmj.message_id=m.ROWID WHERE cmj.chat_id=c.ROWID ORDER BY m.date DESC LIMIT 1) as last_message,
    (SELECT m.date FROM message m JOIN chat_message_join cmj ON cmj.message_id=m.ROWID WHERE cmj.chat_id=c.ROWID ORDER BY m.date DESC LIMIT 1) as last_date
  FROM chat c WHERE last_date IS NOT NULL ORDER BY last_date DESC LIMIT 50"
```

### Search messages by text (text column + attributedBody blob)
```bash
/usr/bin/sqlite3 -json -readonly "$DB" "
  SELECT m.ROWID, m.text, m.is_from_me, m.date, COALESCE(h.id,'') as handle_id, c.guid as chat_guid, COALESCE(c.display_name,'') as chat_name,
         hex(m.attributedBody) as attributedBody_hex,
         (SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID) as attachment_count
  FROM message m LEFT JOIN handle h ON m.handle_id=h.ROWID
  JOIN chat_message_join cmj ON cmj.message_id=m.ROWID JOIN chat c ON c.ROWID=cmj.chat_id
  WHERE (m.text LIKE '%term%' ESCAPE '\' OR CAST(m.attributedBody AS TEXT) LIKE '%term%' ESCAPE '\')
  ORDER BY m.date DESC LIMIT 50"
```

### Messages from a contact (by handle): emails exact, phones by last 10 digits
```bash
... WHERE (h.id LIKE '%5551234567' ESCAPE '\' OR h.id = 'alice@example.com') ORDER BY m.date DESC LIMIT 50
```

### Watching a live thread for a reply: poll on ROWID, never on a computed timestamp

Poll loops that break out immediately and report "no reply" while sitting on stale data all share one
mistake: **the exit condition matched something that was already there.**

- **Don't hand-compute an Apple-epoch cutoff.** `date/1000000000 + 978307200` converts *out* fine, but computing
  the boundary *in* (from a wall-clock time read off an earlier query) is an off-by-timezone waiting to
  happen. A 7200-second slip makes the filter match the whole thread.
- **Don't use "any inbound in the last N seconds" as the condition.** The message you are replying *to* is inside
  that window, so the loop exits on turn one.

**Capture a baseline ROWID before you send, then poll for anything greater:**

```bash
CHAT='+15551234567'
MAX=$(/usr/bin/sqlite3 -readonly ~/Library/Messages/chat.db "SELECT MAX(m.ROWID) FROM message m
  JOIN chat_message_join cmj ON cmj.message_id=m.ROWID JOIN chat c ON c.ROWID=cmj.chat_id
  WHERE c.chat_identifier='$CHAT'")
# ...send your message here...
for i in $(seq 1 40); do
  n=$(/usr/bin/sqlite3 -readonly ~/Library/Messages/chat.db "SELECT COUNT(*) FROM message m
    JOIN chat_message_join cmj ON cmj.message_id=m.ROWID JOIN chat c ON c.ROWID=cmj.chat_id
    WHERE c.chat_identifier='$CHAT' AND m.is_from_me=0 AND m.ROWID > $MAX")
  [ "$n" -ge 1 ] && break
  sleep 15
done
```

Run it in the background if your harness blocks a foreground `sleep`. ⚠️ **Backgrounded `sleep N` calls can
return early**, so never infer elapsed time from how many sleeps were issued. Print `date` inside the command
and read that instead.

**Sanity checks that cost nothing:** `SELECT service, COUNT(*), MAX(datetime(...)) FROM message WHERE is_from_me=0
GROUP BY service` confirms SMS relay from the iPhone actually reaches this Mac before you rely on reading a reply
at all. And `m.text` is **NULL on your own outbound messages** (the body lives in `attributedBody`), so an outbound
row reading `null` is normal, not a failed send. Check `is_sent=1, error=0` instead.

## MESSAGES: send (JXA)

⛔ **An iMessage send is immediate, outward-facing, and has no undo.** There is no draft state. Confirm the recipient and the text with the user before calling this.

### Send to an existing chat by guid
```javascript
(() => {
  const M = Application("Messages");
  const chats = M.chats.whose({id: "{{chatId}}"})();
  if (chats.length === 0) throw new Error("Chat not found");
  M.send("{{text}}", {to: chats[0]});
  return JSON.stringify({sent: true, chatId: "{{chatId}}"});
})()
```

### Send to a new recipient: plain AppleScript (`osascript -e`, NOT JXA)
```applescript
tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant "+15551234567" of targetService
    send "Hello there" to targetBuddy
end tell
```
(No delete or edit of messages. Apple limitation.)

## MAIL: reads from `~/Library/Mail/V10/MailData/Envelope Index`

`date_received` is **Unix seconds**. Schema: `messages(ROWID, sender→addresses, subject→subjects, summary→summaries, mailbox→mailboxes, date_received, read, deleted, flags)`; `addresses(ROWID, address, comment)` (`comment`=display name); `subjects`, `summaries`, `mailboxes(ROWID, url, total_count, unread_count)`; `recipients(message, address, type)` type 0=to/1=cc; Gmail `labels(message_id, mailbox_id)` join. **Full body text is NOT in SQLite.** Only the `summary` preview is stored. Fetch full content via the JXA recipe below.

```bash
DB=~/Library/Mail/V10/MailData/"Envelope Index"
```
BASE_SELECT used by most reads:
```sql
SELECT m.ROWID, s.subject, a.address, a.comment, m.date_received, m.read, mb.url as mailbox_url, sm.summary
FROM messages m
LEFT JOIN subjects s ON m.subject=s.ROWID
LEFT JOIN addresses a ON m.sender=a.ROWID
LEFT JOIN mailboxes mb ON m.mailbox=mb.ROWID
LEFT JOIN summaries sm ON m.summary=sm.ROWID
```
SKIP_MAILBOXES (exclude Trash/Junk/Sent/Drafts): append
```sql
AND mb.url NOT LIKE '%/Trash' AND mb.url NOT LIKE '%/Junk' AND mb.url NOT LIKE '%25Junk'
AND mb.url NOT LIKE '%/Deleted%20Messages' AND mb.url NOT LIKE '%/Sent%20Mail'
AND mb.url NOT LIKE '%/Sent%20Messages' AND mb.url NOT LIKE '%/Sent' AND mb.url NOT LIKE '%/Drafts'
```

### List inbox (Gmail-aware: INBOX is a label in `[Gmail]/All Mail`)
```bash
/usr/bin/sqlite3 -json -readonly "$DB" "
  SELECT m.ROWID, s.subject, a.address, a.comment, m.date_received, m.read, mb.url as mailbox_url, sm.summary
  FROM messages m
  LEFT JOIN subjects s ON m.subject=s.ROWID LEFT JOIN addresses a ON m.sender=a.ROWID
  LEFT JOIN mailboxes mb ON m.mailbox=mb.ROWID LEFT JOIN summaries sm ON m.summary=sm.ROWID
  WHERE m.deleted = 0 AND (
    LOWER(mb.url) LIKE '%/inbox'
    OR m.ROWID IN (SELECT l.message_id FROM labels l JOIN mailboxes imb ON l.mailbox_id=imb.ROWID WHERE LOWER(imb.url) LIKE '%/inbox'))
  ORDER BY m.date_received DESC LIMIT 50 OFFSET 0"
```

### Search (subject OR sender address OR sender name OR summary)
```sql
<BASE_SELECT> WHERE m.deleted = 0 <SKIP_MAILBOXES>
AND (s.subject LIKE '%term%' ESCAPE '\' OR a.address LIKE '%term%' ESCAPE '\'
     OR a.comment LIKE '%term%' ESCAPE '\' OR sm.summary LIKE '%term%' ESCAPE '\')
ORDER BY m.date_received DESC LIMIT 50 OFFSET 0
```
By sender email: `... AND (a.address LIKE '%email%' ESCAPE '\') ...`. By sender name: `... AND a.comment LIKE '%name%' ESCAPE '\' ...`.

### Get one message by ROWID (+ to/cc)
```bash
/usr/bin/sqlite3 -json -readonly "$DB" "
  SELECT m.ROWID, s.subject, a.address, a.comment, m.date_received, m.read, mb.url as mailbox_url, sm.summary,
    (SELECT GROUP_CONCAT(ra.address, ', ') FROM recipients r JOIN addresses ra ON r.address=ra.ROWID WHERE r.message=m.ROWID AND r.type=0) as to_addresses,
    (SELECT GROUP_CONCAT(ra.address, ', ') FROM recipients r JOIN addresses ra ON r.address=ra.ROWID WHERE r.message=m.ROWID AND r.type=1) as cc_addresses
  FROM messages m LEFT JOIN subjects s ON m.subject=s.ROWID LEFT JOIN addresses a ON m.sender=a.ROWID
  LEFT JOIN mailboxes mb ON m.mailbox=mb.ROWID LEFT JOIN summaries sm ON m.summary=sm.ROWID
  WHERE m.ROWID = 12345"
```

### List mailboxes (non-empty)
```bash
/usr/bin/sqlite3 -json -readonly "$DB" "SELECT url, total_count, unread_count FROM mailboxes WHERE total_count > 0 ORDER BY total_count DESC"
```
Mailbox URL `imap://UUID/%5BGmail%5D/All%20Mail` → account = UUID, name = last path segment URL-decoded (`All Mail`).


---

## MAIL: writes (JXA)

⛔ **A draft is not a send.** Creating a draft is reversible. Sending is not. Do not send mail on a user's behalf without an explicit instruction for that specific message.

### Get the full body of one message by id

SQLite stores only the `summary` preview. The full `content` comes from JXA:

```javascript
(() => { const Mail = Application("Mail"); const accts = Mail.accounts();
  for (let a=0;a<accts.length;a++){ const mbs=accts[a].mailboxes();
    for (let b=0;b<mbs.length;b++){ const ms=mbs[b].messages.whose({id:"{{id}}"})();
      if (ms.length>0) return JSON.stringify({id:ms[0].id().toString(), content:ms[0].content()||""}); } }
  return JSON.stringify(null); })()
```

Mail's JXA `id` is the numeric ROWID stringified, the same id the SQLite reads return.

⚠️ **`Mail.accounts()` enumeration hangs on some IMAP configurations.** If the loop above stalls, target the message through the mailbox you already know from the SQLite `mailbox_url` instead of walking every account.

### Create a draft

```javascript
(() => {
  const Mail = Application("Mail");
  const msg = Mail.OutgoingMessage({
    subject: "{{subject}}",
    content: "{{body}}",
    sender: "{{fromAddress}}",   // must match an enabled account; omit for the default account
    visible: false
  });
  Mail.outgoingMessages.push(msg);
  msg.toRecipients.push(Mail.ToRecipient({address: "{{to}}"}));
  msg.saveMessage();
  return JSON.stringify({created: true});
})()
```

**Three things bite here and they all look like success:**

1. **Put `sender` in the constructor, not as a later assignment.** Assigning it after the push silently drops the recipients.
2. **Push the message first, then the recipients.** Recipients set on an unpushed `OutgoingMessage` do not stick.
3. **Verify after a delay, and read back from the Drafts mailbox, not from the outgoing message.** An empty `toRecipients()` read within the first ~30 seconds is a read race, not a dropped recipient. JXA reports success on writes that did not land, and reports empty on writes that did.

Read-back that actually settles it, via AppleScript against the account's Drafts mailbox:

```applescript
tell application "Mail"
  set ds to (every message of mailbox "Drafts" of account "{{accountName}}" whose subject is "{{subject}}")
  if (count of ds) = 0 then return "NOT FOUND"
  return (address of to recipient 1 of item 1 of ds)
end tell
```

### HTML drafts

Set `htmlContent`, not `content`. Both on the same message is undefined behavior; pick one.

```javascript
const msg = Mail.OutgoingMessage({subject: "{{subject}}", sender: "{{fromAddress}}", visible: false});
Mail.outgoingMessages.push(msg);
msg.htmlContent = "{{html}}";
msg.toRecipients.push(Mail.ToRecipient({address: "{{to}}"}));
msg.saveMessage();
```

Apple Mail's own viewer wraps scripted HTML in a `<blockquote type="cite">`, which draws a quote bar down the left side. It is not in the HTML and other clients ignore it.

### Replies

⚠️ **A new message with an `Re:` subject is not a reply.** It has no `In-Reply-To` or `References` header, so it starts a new thread in the recipient's client.

A real reply uses Mail's `reply` verb, and the verb needs `with opening window` to carry the quoted original:

```applescript
tell application "Mail"
  set m to first message of inbox whose subject is "{{subject}}"
  reply m with opening window
end tell
```

⛔ **Never set `content` or `htmlContent` on a reply.** Either one destroys the quoted original. The body has to be typed or pasted at the cursor, which means the compose window needs focus. A brand-new message can be built with `visible: false`; a threaded reply cannot.

⚠️ **The system clipboard is shared state.** If you paste into a compose window, guard the paste by checking the clipboard contents match what you put there. Another process can turn it over in between.

### Attachments

```javascript
msg.attachments.push(Mail.Attachment({fileName: Path("{{absolutePath}}")}));
```

A saved draft cannot take an attachment after the fact. Build the message with `visible: true` and attach before saving.

### Mark read/unread, delete

```javascript
msg.readStatus = true;   // or false
Mail.delete(msg);        // moves to Trash
```

⛔ **Never bulk-close or bulk-delete `Mail.outgoingMessages`.** That list is shared across every process on the machine, so it can hold drafts belonging to other sessions or to the user. Target one message by identity, and read back to confirm what actually happened before reporting it.
