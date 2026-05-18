# TokenShield Outreach Scripts

Three channels, three scripts. Send 20 messages by Friday. Track responses in a plain Google Sheet.

## Targeting principles

**Good fits (in this order):**
1. VPs of Eng / Heads of Platform at Series A–C startups (50–500 engineers)
2. Engineering managers who post about Claude Code / Cursor on X
3. Solo CTOs at small/mid startups who tweet about AI bills
4. r/ClaudeAI and r/cursor power posters
5. ProductHunt makers shipping AI products

**Avoid:**
- FAANG-tier — wrong sales motion, 6-month procurement
- Anyone who responded to a TokenShield post but didn't ask about cost (they want the free tool, not the pilot)
- "Growth hackers" / "AI influencers" — wrong buyer

## Where to find them

- **X**: search `(claude code OR claude OR cursor) (expensive OR cost OR bill OR spend)` filter `min_faves:5 lang:en`
- **Reddit**: r/ClaudeAI, r/cursor, r/Anthropic — sort by top this month, look for cost threads
- **HN**: search "claude code" past month, look at engineering-leader profiles in comments
- **LinkedIn**: search "VP Engineering" + "Claude" or "AI tooling" in posts past 30 days
- **Your existing network**: 5–10 people in your contacts who manage eng teams

---

## Script 1 — X / Twitter DM (short, warm)

Use when: you've seen them post about Claude Code cost or AI spend in the last 30 days.

> Hey [first name] — saw your post about [specific quote, 4–6 words]. Built something for exactly that: TokenShield, a local proxy that measures Claude Code spend per-engineer + plugs in dedup/cache processors to cut bills 40–70%.
>
> Running a 10-team founding pilot, $499 setup + $199/mo locked forever, 90-day money-back if savings don't hit 30%. Worth a 15-min call?
>
> Details: curatedmcp.com/tokenshield/pilot

**Why this works:**
- References their specific post (proves you're not spamming)
- Names the product + the price + the guarantee in 3 lines
- One link, one ask
- 15 min (not 30) is easier to commit to

---

## Script 2 — Cold email (warmer, longer)

Use when: you have their work email, ideally because they're a 2nd-degree connection.

**Subject:** quick question about your team's Claude bill

> [First name],
>
> Short note. I'm building TokenShield — a local proxy that sits in front of Claude Code, Cursor, Windsurf, etc. and measures token spend per engineer, per project, per model. Then it plugs in optimizations (dedup, result-cache, file-diff) that typically cut the bill 40–70%.
>
> Live now as a free CLI: `npm install -g @curatedmcp/tokenshield`. Used by [X teams / Y engineers — fill in once you have data]. The optimization processors ship through Q3.
>
> I'm running a 10-team Founding Pilot. The deal:
> - $499 one-time setup (I personally Zoom-install with your team)
> - $199/mo retainer, **locked at this rate forever**
> - Weekly PDF reports showing measured savings vs baseline
> - Every new processor flips on for your team the day it ships
> - 90-day money-back if measured savings don't hit 30%+
>
> If [Company]'s Claude bill is over $1k/mo, the math is straightforward — a 20-person team typically saves $3k+/mo net of our fee.
>
> Open to a 15-min Zoom this week or next?
>
> [Your name]
> Founder, CuratedMCP
> curatedmcp.com/tokenshield/pilot

**Why this works:**
- Identifies real-world workflow (Claude Code, Cursor, Windsurf — not just "Claude")
- Shows traction proof (npm package exists, users exist)
- Frames the pilot as exclusive (10 teams), not desperate
- Has a clear math justification ($1k+/mo Claude → ROI obvious)
- Tight subject line, no preamble

---

## Script 3 — LinkedIn message (most formal, for VPs+)

Use when: target is VP-level or higher at a 200+ person company, where decorum matters.

> Hi [first name],
>
> I'm reaching out because [Company] is the kind of team where Claude Code/Cursor adoption is probably outrunning the visibility your finance team has into AI spend. (If I'm wrong, please tell me — I'll stop bothering you.)
>
> I'm running a Founding Pilot for TokenShield, a local proxy that gives engineering leaders per-engineer + per-project visibility into Anthropic API spend, then progressively activates compression processors (dedup, cache, diff) to cut the bill 40–70%.
>
> The pilot is 10 teams, $499 setup + $199/mo locked forever, 90-day money-back guarantee on 30%+ measured savings.
>
> If this is on your radar, the full breakdown is at curatedmcp.com/tokenshield/pilot. Happy to send the DPA + SOC 2 roadmap directly if useful for an early gut-check with your security team.
>
> [Your name]

**Why this works:**
- "If I'm wrong, please tell me" — disarms the spam-detector instinct
- Speaks to finance-team visibility (their actual P&L pain), not just engineering cost
- Mentions DPA + SOC 2 — they care about that even at 200 engineers
- Doesn't ask for a call up front; just offers the deck

---

## Follow-up cadence

Day 0: Initial message
Day 4: Soft bump — "Hey, want to make sure this didn't get buried. Worth a 15-min look?"
Day 10: Final bump — "Last note from me — I'm closing applications for the founding cohort in [DATE]. After that the rate doubles."
Day 11+: Move on. They'll come back when they're ready.

Never send more than 3 messages to a cold target.

---

## Response handling

| Response | Action |
|---|---|
| "Tell me more" | Send Loom video (3 min) + book Calendly link |
| "We don't have time to evaluate" | Reply: "Totally — 15 min for the install + we run on autopilot. The reports go to you weekly. If you don't like them you cancel." |
| "We're already using [X competitor]" | Reply: "Curious which one + how it's going. If you're getting >30% savings already, ignore me." |
| "Send me a deck" | Don't have a deck. Send the pilot page link. If they push, send the whitepaper. Decks lose deals at this stage. |
| "What's your SOC 2 status?" | Honest answer: "On the roadmap. Pilot is local-first so prompts never leave your machines. DPA template available; happy to walk your security team through the architecture." |
| Silence | Bump twice, then drop. |

---

## What to track in your sheet

| Column | Why |
|---|---|
| Date sent | Cadence enforcement |
| Channel | DM / Email / LinkedIn |
| Name | Person |
| Company | Org |
| Hook (quote/post) | What you referenced |
| Response | Yes / No / Maybe / Silent |
| Booked | Call date if scheduled |
| Closed | $ when invoice paid |
| Why lost | If they passed — capture the reason |

The "Why lost" column is the most valuable. After 50 sends, you'll see patterns. Patterns become product/pricing/pitch fixes.
