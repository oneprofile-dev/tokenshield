# TokenShield Founding Pilot Agreement

**Between:** CuratedMCP ("we", "us") and [CLIENT COMPANY] ("you", "your team")
**Effective date:** [DATE]
**Pilot reference:** TS-FP-[NNNN]

This is a 1-page plain-English agreement. The legal binding language is at the bottom. If anything below is unclear, email **curatedmcp@gmail.com** before signing.

---

## What we agree to deliver

1. **White-glove install (Week 1).** One 30-minute Zoom session with up to [N] engineers from your team. We install TokenShield on each developer's machine, verify telemetry is flowing, and establish your baseline Claude spend.
2. **Every TokenShield processor as it ships, free.** As we release `conversation-dedup`, `result-cache`, `diff-file-reads`, `context-summarizer`, and future processors during the pilot window, your team's seats are automatically enabled — at no additional charge.
3. **Weekly savings reports.** Every Friday, a PDF report showing measured spend per engineer, per model, per project, vs your Week 1 baseline. Delivered for the full 12 weeks.
4. **Dedicated support channel.** Shared Slack or Discord channel with our engineering team during business hours (US Eastern). Response SLA: 1 business day.
5. **Bi-weekly check-ins.** 15-minute syncs or async written updates — your preference.

## What you agree to provide

1. **Payment.** A one-time $499 USD setup fee on signing + $199 USD/month retainer starting Week 1. Paid via Stripe Invoice (net-15) or credit card.
2. **A pilot champion.** One named contact at your company who attends kickoff, receives reports, and routes our questions internally.
3. **Engineer cooperation.** Each participating engineer sets `ANTHROPIC_BASE_URL=http://127.0.0.1:7777` in their shell during the pilot. They keep their own `ANTHROPIC_API_KEY`; we never see it.
4. **A baseline measurement window.** At least 5 business days of normal usage before processor activation, so we can prove savings against your real spend, not a guess.

## The 90-day money-back guarantee

If, by **day 90** of the pilot, your **measured** Claude API spend has not dropped by at least **30%** compared to your Week 1 baseline (calculated on the same set of engineers, same projects, same tools), we will refund:

- 100% of the $499 setup fee
- 100% of every monthly retainer paid

To trigger the guarantee, email curatedmcp@gmail.com referencing this pilot's reference number. We refund within 5 business days via the original payment method, no questions asked.

The guarantee does **not** apply if:
- Fewer than 50% of named engineers had `ANTHROPIC_BASE_URL` set during the measurement window
- You changed AI tooling mid-pilot (e.g., dropped Claude entirely)
- You declined to enable our processors when they shipped during the pilot

## The founding rate (the part that matters)

After day 90, you may continue at the **founding rate of $199/month**, which we promise:
- Will never increase for as long as your subscription is active
- Persists across plan changes (if we launch tiers, you keep this rate)
- Persists across company restructure on your side (acquisition, rename) provided headcount on TokenShield stays under [N × 2]
- Transfers to a successor entity if CuratedMCP is acquired

If you cancel and re-subscribe later, the founding rate is forfeit. One-way door.

## Data handling

- **Prompt content** stays on engineer machines. Period. We have no way to retrieve it.
- **Aggregate metrics** (request counts, token counts, model, endpoint, duration, cost) sync to your private dashboard at `curatedmcp.com/tokenshield/dashboard`.
- **Your dashboard** is access-controlled to email addresses you list at kickoff.
- **Exports** are available as CSV anytime. Deletion within 30 days of written request.
- **DPA** template available on request before signing.

## Term & termination

- Initial term: 12 weeks from Week 1 kickoff
- Auto-renews month-to-month at the founding rate after day 90
- Either party may cancel monthly renewal with 7 days' notice
- We may terminate immediately for non-payment after a 7-day cure period
- Setup fee is non-refundable outside the 90-day guarantee

## The legal bit

This is a binding agreement under the laws of [your state/country — TBD]. Disputes resolved in [jurisdiction]. Neither party's liability exceeds 12 months of fees paid. We carry [TBD] in cyber liability insurance and can share the certificate on request.

---

## Signatures

**For CuratedMCP**
Name: ____________________________
Title: ____________________________
Date: ____________________________
Signature: ____________________________

**For [CLIENT COMPANY]**
Name: ____________________________
Title: ____________________________
Date: ____________________________
Signature: ____________________________

---

*Internal note: this template is intentionally light on legalese. Before sending to a customer with a real legal team (>200 engineers), have a lawyer review. For pilots 1–10 with smaller teams, this template + DocuSign is sufficient.*
