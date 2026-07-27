# Phase 2 control inventory

Generated from a real browser run. 26 controls exercised, 26 passing.

A control with no row here was never clicked. Absence is the signal.

| Route | Kind | Label | Role | Expected | Actual | Network | Keyboard | Result |
|---|---|---|---|---|---|---|---|---|
| `/dashboard` | status-action | Executive brief text | ORG_OWNER | no "No automations failed today." claim | absent | — | — | PASS |
| `/dashboard` | status-action | Workflow/automation metrics | ORG_OWNER | no invented workflow or automation metric | none present | — | — | PASS |
| `/dashboard` | nav | Active workspace name in sidebar | ORG_OWNER | shows "Downtown Studio" | visible | — | — | PASS |
| `/dashboard` | status-action | Browser storage | ORG_OWNER | no readable token in localStorage/sessionStorage | clean | — | — | PASS |
| `/agent` | button | Plan-preview control | ORG_OWNER | control absent | absent | — | — | PASS |
| `/agent` | select | Tool list | ORG_OWNER | tools populated from GET agent/tools | 6 tools: getDashboard, createContact, searchContacts, createPipeline, createOpportunity, moveOpportunity | GET /agent/tools | — | PASS |
| `/agent` | form | Parameter fields for createOpportunity | ORG_OWNER | named parameters shown from the published schema | parameters shown | — | — | PASS |
| `/agent` | status-action | High-risk approval warning | ORG_OWNER | console indicates this action may need approval | warning shown | — | — | PASS |
| `/approvals` | nav | Approvals page load | ORG_OWNER | pending requests listed | listed | GET /agent/approvals | — | PASS |
| `/approvals` | status-action | Request arguments | ORG_OWNER | arguments shown verbatim | visible | — | — | PASS |
| `/approvals` | status-action | REJECTED status label | ORG_OWNER | distinct from cancelled | "Rejected by an approver" | — | — | PASS |
| `/approvals` | button | Approve and run | ORG_OWNER | POST resolve, row leaves pending | resolve requested | POST /agent/approvals/63262abd-497e-4c73-93bf-6bb55a19175c/resolve | — | PASS |
| `/approvals` | button | Approve control for own request | WORKSPACE_ADMIN (requester) | not offered to the requester | not offered | — | — | PASS |
| `/team` | nav | Team page load | ORG_OWNER | members listed | listed | GET /team/members | — | PASS |
| `/team` | status-action | Member payload | ORG_OWNER | no password hash exposed | none present | — | — | PASS |
| `/team` | form | Invite form, blank email | ORG_OWNER | refused before any request | no request made | NO REQUEST | — | PASS |
| `/team` | form | Invite form, invalid email | ORG_OWNER | refused before any request | no request made | NO REQUEST | — | PASS |
| `/team` | select | Invite role select | ORG_OWNER | SUPERADMIN and AGENT absent | only grantable roles | — | — | PASS |
| `/team` | button | Create link | ORG_OWNER | POST invitation, one-time link shown with a warning | link shown with retrieval warning | POST /team/invitations | — | PASS |
| `/team` | table-action | Pending invitation row | ORG_OWNER | new invitation appears as pending | visible | — | — | PASS |
| `/team` | table-action | Revoke invitation | ORG_OWNER | DELETE invitation, row disappears | delete requested | DELETE /team/invitations/f719a24b-612c-42b1-85d0-cf97ed92e861 | — | PASS |
| `/dashboard` | modal | Switch workspace | ORG_OWNER | opens picker by READING memberships, no password prompt | memberships read | GET /api/auth/memberships | — | PASS |
| `/dashboard` | modal | Switch dialog password field | ORG_OWNER | no password input | none | — | — | PASS |
| `/dashboard` | modal | Workspace choice list | ORG_OWNER | workspaces shown by name | "Airport Location" visible | — | — | PASS |
| `/dashboard` | button | Open workspace "Airport Location" | ORG_OWNER | POST switch-workspace, reload into the new workspace | switch requested | POST /api/session/switch-workspace | — | PASS |
| `/dashboard` | status-action | Post-switch workspace context | ORG_OWNER | new workspace named and active | new workspace active | — | — | PASS |
