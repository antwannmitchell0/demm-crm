# GHL DEMM — Existing Number Checklist (Antwann, do this yourself in the GHL dashboard)

Purpose: confirm whether GHL DEMM (location `C9kHiYdwiE9F20AP4Ufm`) already has a usable phone number before we buy a new one from Twilio. This does not block the code build — it can happen anytime before the real-provider activation stage.

Check each of these inside **Settings → Phone Numbers** (and **Settings → Business Profile / A2P** where noted) in the GHL DEMM location:

1. **Existing phone numbers** — is there a number provisioned for this location at all? Note the number(s).
2. **Number ownership** — is it owned directly by this GHL sub-account, or inherited/shared from an agency-level GHL account? (Shared numbers usually can't be ported out cleanly.)
3. **Voice capability** — does the number show voice/calling enabled, or SMS-only?
4. **SMS capability** — does the number show SMS enabled?
5. **A2P 10DLC registration status** — under Settings → Phone Numbers → A2P/Compliance: is the brand/campaign `Verified`, `Pending`, `Rejected`, or `Not Registered`? (A2P-unregistered numbers get SMS throttled or blocked by carriers — this matters a lot.)
6. **Current campaign status** — is the number actively attached to a running GHL automation/campaign right now? (Pulling it out mid-campaign could break something live.)
7. **Portability / release eligibility** — does GHL's dashboard show an option to "release" or port the number out? Some GHL numbers are locked to the platform and can't move to Twilio directly.
8. **Forwarding configuration** — is the number currently forwarding calls/texts anywhere (a real phone, another platform)? Note it so nothing silently breaks if it moves.
9. **Current monthly charges** — what is GHL actually billing for this number today (base line rental + usage), so we can compare against a fresh Twilio number's cost.

**Bring back:** the number(s) found, and answers to 1–9 for each. I'll use that to decide whether `ChannelConnection` should point at an existing ported number or a freshly purchased Twilio one — the schema will support either without changes either way.
