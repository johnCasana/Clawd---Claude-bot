# Clawd HUD

A mod for [Claude Code](https://claude.com/claude-code) that shows your usage KPIs right above the prompt: 5h and 7d windows, resets, context, tokens, cost and activity. Next to them, an animated Clawd (the mascot) changes role based on what Claude is doing.

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────╮
│  [animated 5h       ████▋░░░░░░░░░  58%  42% left · ↻ today 16:45 (2h14m)                         │
│   Clawd]   7d       █▊░░░░░░░░░░░░  21%  79% left · ↻ Thu 23 09:00 (3d 4h)                         │
│            Context  ██████░░░░░░░░  44%  88k / 200k · 112k left                                    │
│            Model    Opus 5.5 · effort high                                                         │
│            Tokens   1.2M input · 84k output · 1.3M total · 72% cached                              │
│            Cost     $3.42 · $1.20/h                                                                │
│            Session  1h23m · 12 edits · 30 commands · 85 tools                                      │
│            Path     ~/Clawd---Claude-bot  ↑ main → johnCasana/Clawd---Claude-bot · 2m ago          │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
```

## Install

In the terminal, inside a Claude Code session:

```
/plugin install clawd-hud --marketplace johnCasana/Clawd---Claude-bot
```

Answer `y` to add the marketplace and pick a scope (Enter takes the user scope). The HUD shows up right away.

From a shell:

```
claude plugin install clawd-hud --marketplace johnCasana/Clawd---Claude-bot
```

In the desktop app: click **+** next to the prompt → **Plugins** → **Add marketplace** with `johnCasana/Clawd---Claude-bot` → **Add plugin**.

## What it shows

| Row | Meaning |
| --- | --- |
| **5h** | Usage of the 5-hour window, % left and when it resets. |
| **7d** | Weekly usage, % left and reset date. |
| **Context** | Context window: tokens used, total size and tokens left. |
| **Model** | Model in use (as `/model` shows it) and the effort of the last request (`/effort`). |
| **Tokens** | Session input, output and total tokens, and the share of input served from the prompt cache. |
| **Cost** | Session cost and cost per hour. |
| **Session** | Duration, edits, commands and tools used. |
| **Path** | The directory Claude works in and, after a `git push`, the branch and the repository it went to (`owner/repo` only, never the remote URL). |
| **Background** | A column on the right, from 150 columns, while background work runs: each task with a 3-row Clawd at work and its tool (it waves and marches `»›` for a subagent, types at `$ ⠋` for a shell, glances up at `◉)` for a monitor, walks for the rest), its description and how long it has run. Two tasks fit; the rest show as `+N more`. Narrower, the Session row counts them (`⧗ 2 in background`). |

The gauges go from green to red. The white `▏` mark shows where you *should* be given the time elapsed in the window: if the bar passes the mark, at that pace you run out of quota before the reset.

Past 90% in 5h or 7d, Clawd turns red and sweats, and a warning shows once per window. Past 80% of the context, a warning suggests `/compact`, once until the context frees up again.

When a turn of 10 s or more ends, a short chime plays (macOS), so you can look away while Claude works. Quicker turns and interrupted ones stay silent.

## Clawd's roles

The role is not written out: you see it in Clawd's animation and in the card's border, which takes the role's color (gray while Clawd sleeps). While a tool runs, its name and elapsed time show under Clawd (`⏵ Bash · 12s`); in the compact version they follow the model.

| Claude's activity | Role | Animation |
| --- | --- | --- |
| `Write`, `Edit`, `NotebookEdit` | 👷 Engineer | Hard hat and hammer |
| Reviews (`/code-review`, review or audit agents) | 📝 Auditor | Glasses, sheet and pencil ticking ✓ |
| `Read`, `Grep`, `Glob` | 🔍 Detective | Checked hat and magnifying glass |
| `Bash` | 💻 Operator | Laptop with a blinking prompt |
| `WebSearch`, `WebFetch`, MCP tools | 🌐 Explorer | Antenna sending signals |
| `Agent` (subagents) | 📣 Director | Megaphone and a marching mini Clawd |
| Thinking, no tools | 💭 Thinker | Cloud where the idea takes shape |
| Successful `git push` (8 s) | 🚀 Shipper | Hops with arms up, an arrow flies up, confetti |
| A tool waits for your permission | 🙋 Waiting | Raises a hand, a `?` blinks, the border blinks yellow, until the tool runs |
| Compacting the context | 🗜 Compactor | Two arrows close in and squeeze it flat |
| Turn interrupted (Esc, 3 s) | 😮 Startled | Wide eyes, a jumping `!` |
| Turn finished | ✨ Ready | Blinks and waves |
| More than 60 s idle, nothing in the background | 💤 Sleeping | Zzz |

## Usage

- `/hud` hides or shows the HUD.
- At 90 columns or more (and enough free height) you see the full card with the big Clawd; in narrow terminals it switches to a compact 3-line version (gauges, model and path, tokens and session).
- Effort appears after the first request to the model and updates on each one; a model without effort shows only its name.

## Requirements and limits

- Claude Code with mod support (function hooks), tested on version 2.1.304.
- 5h and 7d usage only appears on a Pro or Max plan, after the session's first response.
- "Resets" are the 5h and 7d window resets; Claude Code does not expose an extra-credit balance.
- Tokens are counted from when the mod loads in the session.
- A background task shows as soon as it launches and leaves the list as soon as its end notification arrives.
- Claude Code has no fixed spot above the chat: the HUD lives in the band above the prompt.

## Development

```
claude --plugin-dir .          # open a session with the mod loaded from this folder
claude plugin validate .       # check the manifest and hooks
claude plugin test .           # run tests/hud.test.tsx
```

| File | Contents |
| --- | --- |
| `hooks/register.tsx` | Events (tools, turns, usage measurements) and drawing the HUD |
| `hooks/sprites.ts` | Clawd's pixel art per role and the gradient gauges |
| `hooks/format.ts` | Durations, dates, tokens and each window's elapsed-time marker |
| `types/index.d.ts` | The values the mod keeps in session state |
