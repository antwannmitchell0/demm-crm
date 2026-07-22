# DEMM Platform Release 1.0 Build Specification
## Revenue and Entry Operations

**Status:** Green-lit for implementation  
**Authority:** DEMM Ecosystem Constitution v3.0 and DEMM Platform Blueprint v1.0  
**Primary builder:** Antigravity  
**Architecture reviewer:** COUNCIL  
**Operational truth:** DOM26  
**Contradiction and trajectory review:** gbrain  
**Final acceptance:** Antwann

---

## 1. Release Intent

Release 1.0 must turn the existing CRM foundation into a verifiable operating platform for the businesses closest to revenue and Atlanta entry.

The release is not a complete build of all five businesses.

It must deliver a usable vertical slice for:

1. DEMM Marketing
2. DEMM Photo Booths
3. WTAE pilot operations

GREATER and SOFTER must exist as canonical business units and internal client profiles, but their full consumer-product features are outside this release.

---

## 2. Business Outcomes

Release 1.0 should make it possible to:

- capture and manage DEMM Marketing leads;
- sell and onboard founder-tier clients;
- manage Photo Booth inquiries, bookings, deposits, events, and galleries;
- operate a basic WTAE event safely;
- connect Photo Booth gallery delivery to WTAE;
- see actual revenue, pipeline, bookings, risks, and system health;
- prove which source code is deployed;
- stop representing simulated functions as real capabilities.

---

## 3. Locked Decisions

These decisions are approved defaults for Release 1.0.

| Area | Decision |
|---|---|
| Organization | DEMM LLC |
| Business units | DEMM Marketing, DEMM Photo Booths, WTAE, GREATER, SOFTER |
| Initial active build | Marketing, Photo Booths, WTAE |
| GREATER/SOFTER | Internal client profiles only |
| Time zone | America/New_York |
| Currency | USD |
| Marketing founder tiers | $99, $299, $999 |
| Photo Booth average reference | Approximately $500, package-dependent |
| Active booth inventory | Two owned units; 360 inactive |
| Current booth operator | Antwann |
| WTAE early organizer price | $600–$1,000 working test range |
| WTAE higher fee records | Must be verified before canonical use |
| Face matching | Not required in Release 1.0 |
| Cross-business sharing | Denied by default |
| Payments | Real integration or clearly labeled manual recording |
| AI | Real provider or clearly labeled rule-based/simulated mode |
| Production API config | Environment-based; no localhost fallback in production |
| Release identity | Version, commit, build time, environment required |

---

## 4. Non-Goals

Release 1.0 will not:

- build all 23 proposed marketing agents;
- complete GREATER or SOFTER consumer features;
- implement unrestricted cross-business intelligence;
- launch clinical or regulated claims;
- build a photographer marketplace;
- build advanced sponsor auctions;
- automate every contract or payment provider;
- enable face recognition without readiness gates;
- replace working foundation modules unnecessarily;
- rewrite the application from scratch.

---

## 5. Phase 0 — Truth and Recovery

### Objective

Establish one canonical repository, one verifiable deployment path, and a working frontend-to-backend connection.

### Required tasks

1. Identify the canonical repository and production branch.
2. Record current HEAD commit.
3. Inventory duplicate DEMM CRM repositories and classify them.
4. Determine the actual Cloud Run project and required access.
5. Replace hardcoded `http://localhost:3001/api` in the production frontend path.
6. Use environment-based API configuration.
7. Add a safe production guard that fails the build if localhost is embedded.
8. Add version metadata:
   - app version;
   - Git commit;
   - build timestamp;
   - environment.
9. Confirm backend `/health`.
10. Confirm backend `/version`.
11. Confirm frontend login loads.
12. Confirm frontend can call the deployed backend.
13. Preserve screenshots, logs, URLs, commit, and build evidence.

### Acceptance criteria

- Production bundle contains no localhost API reference.
- Frontend successfully reaches backend.
- `/version` returns a real commit rather than `UNKNOWN_COMMIT`.
- A documented command or pipeline reproduces the deployment.
- The release evidence package identifies the exact deployed commit.

No business feature work begins until the frontend-backend path is verified.

---

## 6. Phase 1 — Business Unit Foundation

### Objective

Add the five-pillar operating model without breaking existing tenant, workspace, security, or audit behavior.

### Required capabilities

- BusinessUnit entity.
- Workspace belongs to BusinessUnit.
- Existing organization remains DEMM LLC.
- Migration assigns existing records to a default business unit.
- Business-unit selector in the authenticated UI.
- Business-unit scoping in backend services.
- Permission checks.
- Audit events include business unit and workspace.
- Seed the five canonical business units.
- Create internal client profiles for GREATER and SOFTER.

### Migration principles

- Additive first.
- Backfill before enforcing non-null constraints.
- Preserve existing IDs.
- No destructive rename without compatibility layer.
- Provide rollback steps.
- Verify record counts before and after migration.

### Acceptance criteria

- A user with Marketing-only access cannot read Photo Booth or WTAE records.
- Executive roles can view approved summaries across business units.
- Existing CRM data remains accessible.
- Audit logs show business-unit scope.

---

## 7. Phase 2 — DEMM Marketing Operating Slice

### Required screens

- Marketing Dashboard
- Leads
- Pipeline
- Offers
- Clients
- Onboarding
- Service Delivery
- Tasks
- Client Health
- Reports
- Settings

### Required data

- lead source;
- company;
- contact;
- industry;
- offer;
- price;
- stage;
- expected value;
- next action;
- owner;
- contract state;
- payment state;
- onboarding state;
- service status;
- client health;
- renewal date.

### Required workflows

#### Lead to Discovery

- Create lead.
- Assign owner.
- Record source.
- Set next action.
- Move through pipeline.
- Schedule or record discovery.

#### Discovery to Client

- Select founder tier or custom offer.
- Generate a reviewable scope summary.
- Record agreement state.
- Record payment state.
- Convert lead to client.
- Create onboarding checklist.

#### Client Operation

- Assign deliverables.
- Track due dates.
- Track automation status.
- Record client check-ins.
- Generate evidence-based monthly summary.
- Flag overdue work and at-risk clients.

### Founder-tier scope requirement

Before a tier can be marked publicly available, the system must include:

- included services;
- excluded services;
- onboarding requirements;
- support boundaries;
- reporting cadence;
- cancellation terms;
- setup fee, if any;
- expected launch time.

### Acceptance criteria

- Antwann can enter a lead and move it to active client.
- A client record shows the selected offer, amount, scope, onboarding, and next action.
- The dashboard shows real pipeline value and collected revenue.
- No report invents lead or revenue results.

---

## 8. Phase 3 — DEMM Photo Booths Operating Slice

### Required screens

- Photo Booth Dashboard
- Inquiries
- Availability
- Packages
- Quotes
- Bookings
- Calendar
- Equipment
- Operators
- Event Checklist
- Payments
- Galleries
- Reviews

### Required workflows

#### Inquiry to Booking

- Capture inquiry.
- Record date, location, event type, duration, and guest estimate.
- Check equipment availability.
- Select package.
- Create quote.
- Record contract status.
- Record deposit.
- Confirm booking.

#### Event Preparation

- Assign equipment.
- Assign operator.
- Create setup checklist.
- Record venue contact and access instructions.
- Record branding requirements.
- Send or record reminders.
- Flag missing balance, operator, equipment, or venue details.

#### Event Completion

- Complete event checklist.
- Record incidents.
- Mark gallery status.
- Link or create WTAE event.
- Deliver gallery.
- Request review.
- Schedule referral and anniversary follow-up.

### Equipment requirements

- Two owned units represented.
- 360 unit marked inactive.
- Maintenance status.
- Last inspection.
- Next inspection.
- issue history.

### Acceptance criteria

- The system prevents or clearly warns about equipment double-booking.
- The weekly dashboard shows upcoming bookings and money due.
- A completed booking can create or link to a WTAE event.
- Gallery delivery status is visible.
- Antwann can see every missing item before leaving for the event.

---

## 9. Phase 4 — WTAE Pilot Slice

### Required screens

- WTAE Dashboard
- Organizers
- Events
- Event Page Builder
- QR
- Registrations
- Consent
- Photo Upload
- Gallery
- Claims
- Give Flowers
- Engagement Report
- Rebooking

### Required pilot workflow

1. Create organizer.
2. Create event.
3. Select package and price.
4. Generate event page.
5. Generate or map QR destination.
6. Test the QR on a mobile device.
7. Capture attendee name and selected contact method.
8. Present event-specific consent notice.
9. Upload photos.
10. Allow browsing by event.
11. Allow attendee to claim a photo or Moment.
12. Allow optional sharing.
13. Allow Give Flowers under defined rules.
14. Track Qualified Moments Activated.
15. Generate organizer report.
16. Request review and rebooking.

### Consent requirements

The consent record must include:

- event;
- person or session identifier;
- notice version;
- consent choices;
- timestamp;
- source;
- withdrawal state.

### Pilot privacy defaults

- no hidden enrollment into GREATER, SOFTER, or DEMM Marketing;
- no raw event attendee list sold to sponsors;
- no face matching required;
- no attractiveness scoring;
- no downvotes;
- no public display of private contact data;
- clear photo removal request path.

### Acceptance criteria

- Event can be created and opened on mobile.
- QR resolves to the correct event without changing the physical QR when persistent routing is used.
- Attendee can consent, browse, claim, and share.
- Organizer report uses real event data.
- A removal request can be recorded and resolved.
- The flow works without face recognition.

---

## 10. Phase 5 — Executive and Intelligence Summaries

### Required dashboard

The executive dashboard must show:

- 90-day revenue target;
- actual collected revenue;
- projected revenue;
- Marketing pipeline;
- Photo Booth bookings;
- WTAE event revenue;
- overdue payments;
- overdue tasks;
- active risks;
- deployment health;
- broken integrations;
- approvals waiting;
- business-unit health.

### Required outputs

- Daily Operating Brief
- Weekly Revenue Review
- Risk and Contradiction Report
- Release Health Report

### Rules

- Actual, projected, and manually entered figures must be labeled.
- Sensitive GREATER and SOFTER data is excluded.
- Recommendations must cite the metric or record that triggered them.
- General may propose action but may not silently alter money, contracts, permissions, or customer communications.

---

## 11. Security and Privacy

### Required controls

- business-unit scoping;
- workspace scoping;
- role-based permission checks;
- audit logs;
- rate limits;
- validation;
- secret management;
- safe error handling;
- consent records;
- deletion/request workflow;
- field-level restrictions for sensitive modules.

### Prohibited behavior

- logging tokens or secrets;
- exposing private wellness content;
- using one business's consent for another business;
- embedding production secrets in the frontend;
- allowing agents to bypass approvals;
- storing biometric templates without approved policy.

---

## 12. AI and Agent Truthfulness

Every agent feature must be classified as one of:

- real LLM-backed;
- deterministic workflow;
- rule-based recommendation;
- simulated demonstration;
- unavailable.

The UI must not label simulated behavior as autonomous AI.

Every agent run must record:

- agent;
- version;
- input references;
- action;
- output;
- confidence where applicable;
- approvals;
- errors;
- timestamp.

---

## 13. Testing

### Required automated tests

- auth and refresh;
- business-unit isolation;
- workspace isolation;
- permissions;
- Marketing lead-to-client flow;
- Photo Booth inquiry-to-booking flow;
- double-book warning;
- WTAE event creation;
- consent recording;
- photo claim;
- revenue calculations;
- version endpoint;
- production config guard.

### Required end-to-end tests

1. Login.
2. Switch business unit.
3. Create Marketing lead and convert to client.
4. Create Photo Booth booking.
5. Link booking to WTAE event.
6. Open event page on mobile viewport.
7. Register and consent.
8. Claim a photo.
9. View organizer report.
10. Verify executive summaries.

### Manual acceptance

Antwann must complete the three core workflows without developer assistance.

---

## 14. Deployment and Evidence

Each deployment must produce:

- repository;
- branch;
- commit;
- tag;
- build timestamp;
- frontend URL;
- backend URL;
- environment;
- migration version;
- test results;
- screenshots;
- known issues;
- rollback command.

Release status options:

- Not Started
- In Progress
- Blocked
- Deployed Unverified
- Deployed Verified
- Accepted

“Complete” is not a valid status without acceptance evidence.

---

## 15. Observability

Minimum production visibility:

- request errors;
- authentication failures;
- integration failures;
- agent failures;
- queue failures if queues exist;
- payment synchronization failures;
- email/SMS failures when enabled;
- deployment version;
- database health;
- latency;
- audit events.

Silent failure is a release-blocking defect.

---

## 16. Antigravity Operating Rules

Antigravity must:

1. Inspect the existing repository before changing architecture.
2. Preserve working foundation modules.
3. Produce a current-state report before implementation.
4. Work in small, reviewable commits.
5. Run tests after each phase.
6. Stop and document blockers rather than inventing completion.
7. Use environment variables for deployment configuration.
8. Avoid destructive schema changes.
9. Include migrations and rollback notes.
10. Provide evidence for every claimed capability.
11. Maintain a decision log.
12. Ask only questions that materially block implementation.
13. Treat this specification as the build contract.
14. Escalate conflicts with the Constitution.
15. Never expose secrets in output.

---

## 17. Required Deliverables

At release completion, Antigravity must provide:

- architecture summary;
- schema changes;
- migration plan and results;
- environment variable list without secret values;
- API and page inventory;
- test report;
- security review;
- privacy review;
- deployment evidence;
- user acceptance checklist;
- known limitations;
- Release 1.1 recommendations.

---

## 18. Release Exit Criteria

Release 1.0 is accepted only when:

- frontend and backend are verifiably connected;
- exact deployed commit is visible;
- five business units exist;
- access boundaries are enforced;
- Marketing lead-to-client works;
- Photo Booth inquiry-to-event works;
- Photo Booth event links to WTAE;
- WTAE consent-to-claim flow works on mobile;
- dashboards use real data;
- no production localhost reference exists;
- no simulated feature is represented as real;
- automated tests pass;
- Antwann completes user acceptance;
- evidence package is delivered.

---

# Antigravity Kickoff Instruction

Use the following as the opening instruction to Antigravity:

> You are implementing DEMM Platform Release 1.0 under the DEMM Ecosystem Constitution v3.0 and Platform Blueprint v1.0. Begin by inspecting the existing repository and deployment evidence. Do not rewrite working foundation code. First produce a Current-State and Gap Report mapped directly to every Release 1.0 requirement. Then present the smallest safe implementation sequence, migrations, tests, risks, and blockers. After the report, proceed phase by phase unless a blocker requires Chairman approval. Do not claim any feature is complete without code, tests, deployment evidence, and an acceptance path. Production configuration must never contain localhost URLs. Simulated AI must be labeled honestly. Cross-business data access is denied by default. The first usable outcome is a verified revenue and entry operating slice for DEMM Marketing, DEMM Photo Booths, and WTAE.
