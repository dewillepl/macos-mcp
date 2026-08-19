# MCP server or skill

Both surfaces call the same three bridges. The difference is when the model learns they exist.

## The tradeoff

An MCP server registers its tools at session start. All eight tool definitions and their JSON schemas sit in the model's context for the whole session, whether or not the session ever touches a Mac app. That cost is fixed and paid up front.

A skill is one line of description until something matches it. The body loads when the model decides the request is about Reminders, Mail, or Contacts. That cost is variable and paid only when the work is actually happening.

For an agent that touches macOS apps in most sessions, the MCP server is simpler and the context cost is not worth managing. For a general-purpose agent that touches them occasionally, the skill keeps the tool surface out of every unrelated session.

## What each one gives you

| | MCP server | Skill |
|---|---|---|
| Setup | `npx mcp-macos` in a client config | Copy a directory, put `EventKitCLI` on PATH |
| Context cost | 8 tool schemas, always loaded | 1 description line until triggered |
| Client support | Any MCP client | Agents that support skills |
| Input validation | Zod schemas at the tool boundary | The model writes the shell command |
| Extending it | Edit the server, rebuild, republish | Edit a markdown file |

The validation row is the real tradeoff in the other direction. The MCP server validates arguments against a schema before anything reaches `osascript` or `sqlite3`. The skill hands the model raw command construction, which is more flexible and less guarded. If untrusted input reaches these bridges, use the server.

## Running both

Nothing stops you, but the model will see two paths to the same action and pick unpredictably. Choose one per agent.

## Permissions are identical either way

Both need the same grants in System Settings: Reminders, Calendars, Automation per app, and Full Disk Access on whatever binary runs the SQLite reads. See the README's [Permissions](../README.md#permissions) section.
