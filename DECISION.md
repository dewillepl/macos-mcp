# Architecture Decision Records

## ADR-001: SQLite for Reads, JXA for Writes

**Date**: 2026-02-11
**Status**: Accepted
**Issues**: #75 (Messages), #76 (Mail)

### Context

JXA (JavaScript for Automation) accesses macOS apps via Apple Events. Read operations that touch large collections (`messages()`, `mailboxes()`) are O(n) — every call materializes the entire collection. `whose()` predicates help for filtered searches but don't solve bulk reads (inbox listing, default views).

Performance evidence:
- **Messages**: JXA `c.messages()` broken on Sonoma+ entirely. SQLite reads: 135ms vs 60s+ timeout.
- **Mail**: JXA inbox read: 60s timeout (4,446 messages in All Mail). `whose()` fix (`df8bf7a`) insufficient — `accounts()` and `mailboxes()` materialization still O(n).
- **Contacts**: `whose()` fix worked (#77) — smaller collections (~1k contacts).
- **Notes**: `whose()` fix worked (#78) — smaller collections.

### Decision

Use SQLite for all read operations where Apple stores data in an accessible SQLite database. Keep JXA exclusively for write operations (create, update, delete) which require Apple Events.

| App | Read Backend | Write Backend | Database Path |
|-----|-------------|---------------|---------------|
| Messages | SQLite | JXA | `~/Library/Messages/chat.db` |
| Mail | SQLite | JXA | `~/Library/Mail/V10/MailData/Envelope Index` |
| Notes | JXA (whose()) | JXA | N/A — no accessible SQLite |
| Contacts | SQLite (bulk cache) + JXA (whose() search) | JXA | `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb` |

### Trade-offs

**Gains:**
- 100-1000x faster reads (indexed SQLite vs O(n) Apple Events)
- Predictable performance regardless of collection size
- No app launch required for reads

**Costs:**
- Full Disk Access required (already needed for Messages)
- No full message body in Mail SQLite — `summaries` table has previews only (current JXA truncates to 200 chars anyway)
- Message ROWID in SQLite = `m.id()` in JXA — IDs are compatible across backends
- Hybrid complexity: two code paths per tool (SQLite read + JXA write)

### Addendum: Gmail Labels Table (2026-02-11)

Gmail stores all messages in `[Gmail]/All Mail`, not in the INBOX mailbox. Inbox membership is tracked via the `labels` join table:

```sql
-- labels schema: message_id (FK messages.ROWID) → mailbox_id (FK mailboxes.ROWID)
-- Gmail INBOX label = mailbox with url LIKE '%/INBOX'
SELECT l.message_id FROM labels l
JOIN mailboxes imb ON l.mailbox_id = imb.ROWID
WHERE LOWER(imb.url) LIKE '%/inbox'
```

`listInboxMessages()` and `listMailboxMessages()` now check both `messages.mailbox` (non-Gmail) and `labels` (Gmail). Without this, Gmail accounts return 0 messages for any folder — inbox, custom labels (Business, Real Estate, etc.), all of them.

### References

- `src/utils/sqliteMessageReader.ts` — Messages SQLite reader (established pattern)
- `src/utils/sqliteMailReader.ts` — Mail SQLite reader (this ADR)
- `src/utils/sqliteContactReader.ts` — Contacts SQLite reader (ADR-002)
- `df8bf7a` — Mail SOM-level JXA fix (necessary but insufficient)
- `cee2366` — Messages JXA read paths removed

## ADR-002: SQLite for Contact Enrichment Cache

**Date**: 2026-02-12
**Status**: Accepted
**Issues**: #90 (Contact enrichment cold cache)

### Context

Contact enrichment resolves raw phone numbers and email addresses to contact names across Messages, Mail, and Calendar. The enrichment cache (`doBuildCache()` in `contactResolver.ts`) needs to read all contacts with their phone numbers and emails.

The JXA approach (`Contacts.people()` + O(n) JS iteration) consistently times out at 15s with 600+ contacts. The `warmCache()` fix in #90 correctly fires at startup but always produces 0 entries because the JXA bulk fetch never completes. Result: enrichment returns raw phone numbers/emails in all tools.

### Decision

Use SQLite to read contacts from `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb` for the bulk enrichment cache. Keep JXA `whose()` for targeted name-to-handle search (`resolveNameToHandles()`), which is fast and indexed.

| Component | Before | After |
|-----------|--------|-------|
| `doBuildCache()` | JXA `Contacts.people()` — 15s timeout, 0 entries | SQLite read — <50ms, all contacts |
| `resolveNameToHandles()` | JXA `whose()` — works, <1s | **No change** |
| Handler APIs | Same | **No change** |

### Trade-offs

**Gains:**
- 300x faster cache build (<50ms vs 15s timeout)
- Cache warming at startup actually succeeds
- No Full Disk Access required — AddressBook files are user-owned (644)
- Handles multiple sources (iCloud, Exchange, subscribed contacts)

**Costs:**
- CoreData schema dependency (stable since macOS 12, `ZABCDRECORD`/`ZABCDEMAILADDRESS`/`ZABCDPHONENUMBER`)
- Two separate queries per source DB to avoid cartesian product (contact with N emails + M phones)
- If schema changes, `fetchAllContacts()` fails → negative cache → same graceful degradation as before

### Schema Notes

```sql
-- Z_ENT 22 = ABCDContact (regular), Z_ENT 23 = ABCDSubscribedContact (Exchange/shared)
-- Two queries to avoid cartesian product:
-- Query 1: contacts with emails
SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZUNIQUEID,
       e.ZADDRESSNORMALIZED as email
FROM ZABCDRECORD r
JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
WHERE r.Z_ENT IN (22, 23)

-- Query 2: contacts with phones
SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZUNIQUEID,
       p.ZFULLNUMBER as phone
FROM ZABCDRECORD r
JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
WHERE r.Z_ENT IN (22, 23)
```

Post-process: merge email and phone results by `ZUNIQUEID` in TypeScript. Deduplicate across sources by `ZUNIQUEID`.

### References

- `src/utils/sqliteContactReader.ts` — Contacts SQLite reader (this ADR)
- `src/utils/contactResolver.ts` — Consumer: `doBuildCache()` calls `fetchAllContacts()`
- ADR-001 — Established the SQLite-for-reads pattern

## ADR-003: Remove HTTP Transport and Cloudflare Access Path

**Date**: 2026-05-13
**Status**: Accepted
**Issues**: #104, #105, #106, #107, #108, #109, #110
**Commit**: `b7ae42e` (removal) — last HTTP-included release: tag `v2.1.5`

### Context

The server originally shipped two transports: local stdio (Claude Code, Claude Desktop, Cursor on the same Mac) and streamable HTTP behind Cloudflare Access (remote access from phone or laptop). The HTTP path required:

- `src/server/transports/http/` — Express server, JWT verification middleware, health endpoint, rate limiter
- Cloudflare Access for identity-proxy auth (JWT issued by CF, verified against JWKS)
- Cloudflare Tunnel for the network path (Mac Mini behind NAT, no public IP)
- Deploy/tunnel/auto-deploy shell scripts (~1k LOC)
- `docs/CLOUDFLARE_SETUP.md` (703 lines) walking users through CF account setup, tunnel install, access policy
- `macos-mcp.config.json` for transport selection + HTTP/CF env vars
- Dependencies: `express`, `express-rate-limit`, `jose`, `supertest`
- 25 HTTP E2E tests + helpers

The use case was "phone from coffee shop" — Kyle on iOS hitting the Mac Mini's MCP from anywhere. That framing was captured in INTENT.md.

The framing changed. Claude's iOS app added remote dispatch: mobile sends work to a Claude Code session running on the local Mac, which uses the existing stdio MCP. The remote-access requirement evaporated — mobile reaches the server through Claude Code, not through a public HTTPS endpoint.

### Decision

Delete the HTTP transport, Cloudflare Access path, and all supporting infrastructure. Server runs stdio-only.

| Removed | Reason |
|---|---|
| `src/server/transports/http/` (auth, middleware, health, transport) | No remote callers |
| `tests/e2e/http-transport.test.mts` + helpers | Tests for removed code |
| `docs/CLOUDFLARE_SETUP.md` | Setup guide for removed path |
| `scripts/{deploy,setup-tunnel,auto-deploy,test-e2e}.sh` | Tooling for removed path |
| `macos-mcp.config.example.json` | Config schema for removed transport |
| `express`, `express-rate-limit`, `jose`, `supertest` deps | No consumers |
| `INTENT.md` | Obsolete phone-from-coffee-shop framing |
| `AGENTS.md` | Generic boilerplate, partly inaccurate |

Diff: **29 files changed, 59 insertions(+), 5,817 deletions(-)**.

`MCP_TRANSPORT`, `MCP_HTTP_*`, and `CF_ACCESS_*` env vars are no longer recognized. `macos-mcp.config.json` is no longer read.

### Trade-offs

**Gains:**
- ~5.8k LOC removed — proportional reduction in surface area to maintain, test, and document
- No auth surface — no JWT verification, no JWKS rotation, no rate-limiter edge cases
- No deploy story — install is `npx mcp-macos`, not "set up Cloudflare account, install cloudflared, write access policy"
- No transport selection logic in `src/index.ts` or config schema
- Dependency tree shrinks (express + jose + supertest gone)

**Costs:**
- True remote access (non-Claude-mediated) is no longer supported. If a future use case needs it, it must be rebuilt.
- The HTTP+CF Access pattern is no longer demonstrated in this repo's HEAD — it lives in git history (`b7ae42e^`) and can be referenced or revived from there.

### What's preserved

The technique is intact in git history under tag `v2.1.5`. Any future MCP needing remote HTTP + identity-proxy auth can lift the pattern from there: stateless streamable-HTTP server, JWT verification against CF Access JWKS, IPv6-aware rate limiting behind a tunnel.

### References

- `b7ae42e` — Removal commit
- `v2.1.5` — Last release with HTTP transport
- Pre-removal HTTP implementation: `git show v2.1.5:src/server/transports/http/index.ts`
- Pre-removal auth: `git show v2.1.5:src/server/transports/http/auth.ts`
- Pre-removal setup guide: `git show v2.1.5:docs/CLOUDFLARE_SETUP.md`
