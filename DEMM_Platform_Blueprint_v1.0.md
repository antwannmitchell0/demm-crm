# DEMM Platform Blueprint
## Version 1.0 — Product and Operating Architecture

**Owner:** DEMM LLC  
**Authority:** DEMM Ecosystem Constitution v3.0  
**Status:** Approved design baseline  
**Primary implementation target:** Antigravity and the DEMM engineering workflow

---

## 1. Blueprint Objective

The DEMM Platform is a shared operating system for five businesses.

It is not five separate CRMs and not one undifferentiated database.

The platform must provide:

- a shared security and identity foundation;
- business-specific workspaces;
- reusable modules;
- explicit data boundaries;
- shared reporting;
- agent execution with approvals and auditability;
- a controlled executive intelligence layer.

---

## 2. Canonical Hierarchy

```text
DEMM LLC
└── Organization
    ├── Business Units
    │   ├── DEMM Marketing
    │   ├── DEMM Photo Booths
    │   ├── WTAE
    │   ├── GREATER
    │   └── SOFTER
    ├── Workspaces
    ├── Shared Modules
    ├── Business-Specific Modules
    ├── Agents
    └── Intelligence Layer
```

### Organization

The legal and executive boundary: DEMM LLC.

### Business Unit

A canonical business with its own:

- customers;
- offers;
- workflows;
- revenue;
- dashboards;
- permissions;
- data policy.

### Workspace

An operating subdivision inside a business unit.

Examples:

- DEMM Marketing / Internal Operations
- DEMM Marketing / Client: Lawn Care
- Photo Booths / Atlanta Operations
- WTAE / Event: Atlanta Pilot
- GREATER / Product Operations
- SOFTER / Product Operations

### Module

A reusable capability such as CRM, bookings, events, contracts, communications, payments, gallery management, subscriptions, analytics, or agents.

---

## 3. Shared Foundation

The shared foundation must support every business.

### Required foundation capabilities

- authentication;
- refresh-token rotation;
- role-based access;
- organization, business-unit, and workspace scoping;
- audit logs;
- approvals;
- tasks;
- contacts and companies;
- opportunities and pipelines;
- configuration validation;
- secret management;
- version and release identity;
- observability;
- backups;
- integration registry;
- notification service.

### Non-negotiable foundation rules

- Every record has an owning business unit.
- Workspace access does not imply access to all business units.
- Sensitive modules may apply stronger access rules.
- Cross-business visibility is summary-first and permission-controlled.
- Production configuration is environment-based.
- Every deployed build exposes version, commit, environment, and build time.
- Every write action by an agent is auditable.
- High-risk actions require approval.

---

## 4. Shared Data Model

### Shared objects

These may use a common platform schema with business-specific ownership:

- Person
- Company
- Contact Method
- User
- Team Member
- Business Unit
- Workspace
- Role
- Permission
- Task
- Note
- Activity
- Opportunity
- Pipeline
- Contract
- Invoice
- Payment
- File
- Consent Record
- Integration
- Automation
- Agent Run
- Approval
- Audit Event

### Business-local objects

These remain owned by a specific business module.

**DEMM Marketing**

- Client Account
- Offer
- Campaign
- Funnel
- Automation Deployment
- Client Health Snapshot
- Service Deliverable

**DEMM Photo Booths**

- Inquiry
- Booking
- Event Service Order
- Equipment Unit
- Equipment Maintenance Record
- Operator Assignment
- Package
- Add-On
- Gallery Delivery

**WTAE**

- Event
- Organizer
- Attendee Registration
- Event Consent
- Moment
- Photo Asset
- Claim
- Flower
- Recognition Category
- Sponsor Activation
- Photographer Assignment

**GREATER**

- Member
- Subscription
- Milestone
- Anniversary
- Brotherhood Activity
- MARCUS Session
- Safety Escalation

**SOFTER**

- Member
- Subscription
- Archetype
- Check-In
- Journal Entry
- Circle Activity
- ARIA Session
- Wellness Escalation

Sensitive GREATER and SOFTER objects must not be implemented as generic CRM notes.

---

## 5. Cross-Business Person Model

A Person may interact with multiple businesses, but the system must not assume that one relationship authorizes another.

Example:

- The same person may be a WTAE attendee.
- They may later become a DEMM Marketing lead.
- They may separately join GREATER or SOFTER.

The platform may maintain a shared identity key, but each relationship requires:

- a business-specific profile;
- purpose limitation;
- consent status;
- communication preferences;
- deletion and retention rules.

Default: no cross-business marketing enrollment.

---

## 6. Business Unit Blueprint — DEMM Marketing

### Current objective

Create a repeatable operating system that allows Antwann to sell and fulfill the $99, $299, and $999 founder offers without holding the entire business in his head.

### Primary users

- Antwann
- future sales representative
- future implementation specialist
- future account manager
- client viewer

### Core modules

- Leads
- Sales Pipeline
- Offers and Pricing
- Discovery
- Proposals
- Contracts
- Client Onboarding
- Service Delivery
- Automations
- Tasks
- Client Health
- Reporting
- Billing
- Referrals

### Minimum workflows

1. Lead captured.
2. Immediate acknowledgement.
3. Qualification.
4. Discovery scheduled.
5. Offer selected.
6. Proposal or agreement sent.
7. Contract accepted.
8. Payment state recorded.
9. Onboarding checklist created.
10. Delivery plan assigned.
11. Weekly health review.
12. Monthly report.
13. Renewal, upsell, or offboarding.

### Dashboard

- MRR
- cash collected
- active clients
- pipeline value
- leads awaiting response
- discovery calls scheduled
- onboarding status
- overdue work
- at-risk clients
- broken automations
- referrals requested
- 90-day target progress

### Agent opportunities

- GRACE: inbound response and intake
- QUALIFIER: fit and readiness
- PROPOSAL: scope drafting
- ONBOARDING COORDINATOR: checklist and asset collection
- CLIENT HEALTH: risk detection
- REPORTER: evidence-based performance summaries

No agent may claim performance without source data.

### Phase 1 locked offer assumptions

- Founder tiers: $99, $299, $999
- Prices are temporary and must be versioned.
- Each tier requires a written scope and explicit exclusions before public launch.
- The platform must support custom agreements without destroying tier reporting.

---

## 7. Business Unit Blueprint — DEMM Photo Booths

### Current objective

Convert Photo Booths into a reliable Atlanta entry and cash vehicle while building the operating procedures needed to remove Antwann from every event.

### Primary users

- Antwann
- booking coordinator
- booth operator
- client
- venue contact

### Core modules

- Inquiries
- Availability
- Packages
- Quotes
- Contracts
- Deposits and Balances
- Bookings
- Equipment
- Maintenance
- Operator Scheduling
- Event Checklists
- Galleries
- Reviews
- Referrals

### Minimum workflows

1. Inquiry received.
2. Date and equipment availability checked.
3. Standard quote generated.
4. Contract issued.
5. Deposit recorded.
6. Event preparation checklist created.
7. Operator and equipment assigned.
8. Pre-event reminders sent.
9. Setup, event, and breakdown checklists completed.
10. Gallery delivered through WTAE where enabled.
11. Review and referral requested.
12. Client anniversary follow-up scheduled.

### Dashboard

- inquiries awaiting response
- bookings this week
- booked revenue
- deposits due
- balances due
- equipment availability
- maintenance alerts
- operator gaps
- upcoming event risks
- average booking value
- review score
- repeat booking rate

### Operator pipeline — Phase 2 requirement

The future passive-income objective requires:

- operator role definition;
- background and reliability screening;
- training checklist;
- paid shadow event;
- certification;
- event-day SOP;
- escalation procedure;
- compensation model;
- quality scoring;
- backup operator pool.

Until this exists, “operator-managed” remains a future state.

### WTAE connection

Each compatible booking may receive:

- event landing page;
- persistent or event-specific QR routing;
- attendee consent flow;
- gallery delivery;
- follow-up;
- organizer engagement summary.

---

## 8. Business Unit Blueprint — WTAE

### Current objective

Deliver a safe, memorable pilot that proves attendees will enter, claim, share, and return—and that organizers will pay for the result.

### Primary users

- organizer
- Antwann / event operator
- photographer
- attendee
- sponsor manager
- reviewer / moderator

### Core modules

- Organizers
- Events
- Event Packages
- Event Pages
- QR Routing
- Registrations
- Consent
- Photo Upload
- Gallery
- Moment Claiming
- Sharing
- Give Flowers
- Recognition
- Sponsors
- Engagement Reporting
- Rebooking

### Pilot workflow

1. Organizer record created.
2. Event created.
3. Package and price recorded.
4. Event page generated.
5. QR destination verified.
6. Attendee receives clear consent and privacy notice.
7. Photos uploaded.
8. Attendee browses or manually finds images.
9. Attendee claims a Moment.
10. Attendee may share and Give Flowers.
11. Organizer receives engagement report.
12. Follow-up asks for review and rebooking.

### Pilot safety rule

Face matching is not required for Release 1.0.

Manual browsing, event codes, and self-identification are acceptable for the first release.

Biometric face matching may only be enabled after:

- explicit opt-in;
- legal and privacy review;
- retention and deletion policy;
- documented vendor behavior;
- alternative non-biometric path;
- security testing.

### Dashboard

- events live
- registrations
- consent completion
- photos uploaded
- moments claimed
- Qualified Moments Activated
- flowers given
- shares
- organizer revenue
- sponsor revenue
- repeat organizer rate
- unresolved moderation issues

### Initial pricing policy

- The working organizer range of $600–$1,000 is a test assumption, not permanent pricing.
- Any higher internal event fee must be verified before it becomes canonical.
- Pricing experiments must record package, scope, cost, result, and organizer feedback.

---

## 9. Business Unit Blueprint — GREATER

### Current platform role

Canonical pillar and internal DEMM Marketing client.

### Release 1.0 scope

- Create business unit and internal client profile.
- Track product status, acquisition readiness, monetization blockers, and safety readiness.
- Do not rebuild the consumer app inside the CRM.
- Do not expose private MARCUS conversations to the executive dashboard.

### Required readiness gates for future expansion

- billing verified;
- onboarding verified;
- character guide approved;
- memory policy approved;
- crisis SOP approved;
- human escalation ownership;
- privacy policy;
- acquisition plan;
- evidence-based retention goals.

### Executive dashboard summary

- active members
- paid members
- MRR
- activation rate
- retention
- safety incidents
- system health

No raw private conversation content.

---

## 10. Business Unit Blueprint — SOFTER

### Current platform role

Canonical pillar and internal DEMM Marketing client.

### Release 1.0 scope

- Create business unit and internal client profile.
- Track signup blocker, billing readiness, ARIA guide, social channels, launch readiness, and safety readiness.
- Do not move journals, cycle data, or raw ARIA conversations into the shared CRM.

### Required readiness gates for future expansion

- signup and email confirmation fixed;
- billing verified;
- ARIA character guide approved;
- wellness escalation SOP;
- privacy and retention policy;
- acquisition plan;
- trial-to-paid measurement;
- human referral boundaries.

### Executive dashboard summary

- active members
- trials
- paid members
- MRR
- conversion
- retention
- safety incidents
- system health

No journals, cycle details, or raw private conversations.

---

## 11. Intelligence and Executive Layer

### Inputs

The executive layer receives structured summaries from:

- revenue systems;
- sales pipelines;
- bookings;
- event engagement;
- product analytics;
- deployment status;
- agent runs;
- approvals;
- audits;
- risk registers.

### Outputs

- daily executive brief;
- 90-day revenue progress;
- overdue decisions;
- top risks;
- broken workflows;
- business-unit health;
- recommended next actions;
- contradiction report.

### Access principle

Summary before detail.

General and COUNCIL may see business health. Access to individual sensitive records requires a defined operational need and elevated permission.

---

## 12. Shared Automations

The platform may reuse automation patterns without merging business data.

Shared patterns:

- immediate lead acknowledgement;
- task assignment;
- contract reminders;
- payment reminders;
- onboarding checklists;
- event reminders;
- review requests;
- rebooking;
- renewal;
- referral asks;
- health alerts;
- executive summaries.

Every automation must be versioned, testable, observable, and pausable.

---

## 13. Communications

The communications module must support, when integrations are available:

- email;
- SMS;
- internal notifications;
- template versioning;
- opt-out;
- consent source;
- delivery status;
- failure alerts.

Release 1.0 must not claim email or SMS capability until a real provider is configured and verified.

---

## 14. Payments and Billing

The platform should record:

- amount;
- currency;
- invoice;
- payment status;
- due date;
- deposit;
- balance;
- refund;
- source;
- external processor reference.

Release 1.0 may begin with manual payment recording if necessary, but the UI must clearly label it as manual.

No simulated payment status.

---

## 15. Reporting Rules

Every KPI must define:

- formula;
- source;
- owner;
- refresh frequency;
- date range;
- exclusions;
- confidence.

Reports must distinguish:

- actual;
- estimated;
- projected;
- manually entered;
- unavailable.

---

## 16. Platform Release Order

### Release 1.0 — Revenue and Entry Operations

- deployment truth;
- shared business-unit model;
- DEMM Marketing;
- DEMM Photo Booths;
- WTAE pilot;
- executive summaries.

### Release 1.1 — Operator and Automation Expansion

- photo booth operator pipeline;
- communication providers;
- advanced payments;
- organizer rebooking;
- automation monitoring.

### Release 2.0 — Transformation Product Operations

- GREATER readiness and growth systems;
- SOFTER readiness and growth systems;
- subscription operations;
- safety and privacy maturity.

---

## 17. Acceptance Standard

A module is not complete because a page exists.

It is complete only when:

- the workflow works end to end;
- permissions are enforced;
- errors are visible;
- tests pass;
- deployment is verified;
- data is auditable;
- a real user can complete the intended job;
- evidence is included in the release package.
