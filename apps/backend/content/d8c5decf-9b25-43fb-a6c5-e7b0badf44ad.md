---
id: d8c5decf-9b25-43fb-a6c5-e7b0badf44ad
title: Kaya suites Business Requirements Document
tags:
- Kaya-suites
- Business Documents
---

# KAYA SUITES

# **Business Requirements Document**

# *AI-Native Knowledge Base Application*

| Document version  | 0.4 (Draft, revised)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status            | Working draft, pending founder review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Product name      | Kaya Suites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Author            | Founder, in collaboration with Claude                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Date              | May 2026                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Audience          | Founder, prospective co-founders, advisors, early hires                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Confidentiality   | Internal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Changes from v0.3 | Section 12 (Commercial Architecture) fully rewritten to reflect final architecture decisions: (1) Cloudflare Workers as the API gateway enforcing entitlement and rate limits from KV; (2) per-team isolated Fly.io Machines (one container, one SQLite volume, one process per team); (3) per-team subdomains (team.kayasuites.com) via Cloudflare DNS; (4) async spend-cap signalling: OSS backend tracks spend locally, signals CF KV and EE backend asynchronously when cap is reached — EE backend is never in the request hot path; (5) Machine lifecycle on cancellation: stop immediately, destroy after 30-day grace period, package data for customer handoff. Functional requirements expanded with gateway, provisioning, spend-signal, and lifecycle entries (FR-47 to FR-62). Non-functional requirements updated for KV consistency window and Machine wake latency. Decisions log updated with D-15 through D-21. All other sections unchanged from v0.3. |



# **1. Executive Summary**

Kaya Suites is an open source, AI-native, AI-agnostic knowledge base application designed to compete with tools such as Notion AI, Confluence, and SharePoint. The product is being built by a solo founder on a bootstrap model, with the intent to raise venture funding once commercial traction validates the thesis. The business model is an open source core with a hosted paid tier, and the long-term vision is a full productivity suite spanning document creation, spreadsheet editing, and presentation building.

The initial product is a focused application for creating, retrieving, and maintaining organizational documents such as Standard Operating Procedures (SOPs), runbooks, policies, and onboarding materials. The central differentiator is an agentic editing model in which a chatbot does not merely generate or summarize documents but actively maintains them as a living source of truth, proposing structured edits when underlying realities change.

This document covers the v0 (four-week prototype shipping both an OSS self-host release and a hosted paid tier), v0.5 (post-launch iterations), and v1 (post-seed-funding product) scopes. It is a living document and will be revised as product, market, and technical learnings accumulate.

# **2. Vision and Strategic Context**

## **2.1 Long-term vision**

To build the default open source, AI-native productivity suite for small and medium teams, replacing the role currently held by Microsoft 365 and Google Workspace for organizations that prioritize data sovereignty, model agnosticism, and the productivity unlock that agent-driven workflows enable.

## **2.2 Initial wedge**

An AI-native organizational knowledge base focused on the lifecycle of internal documents. The product treats documents as living artifacts that an agent helps to author, retrieve, and keep current as the organization evolves. The knowledge base is the entry point; the suite is the destination.

## **2.3 Strategic positioning**

* Open source core: fully self-hostable, locally-runnable, Apache 2.0 licensed, enabling community contribution and enterprise self-hosting without vendor lock-in.
* AI agnosticism: workloads route across multiple model providers based on cost and capability. Privacy-sensitive operations can route to local models. No single-provider lock-in.
* Agentic document maintenance: the agent actively keeps documents current by proposing structured edits when underlying facts change. This is the central novel capability and primary wedge against incumbents.
* Physical data isolation: each paying team receives a completely isolated container, database, and process on Fly.io. No shared application state between teams. This is a structural privacy and security guarantee that SaaS incumbents cannot match.

## **2.4 Funding and growth strategy**

Kaya Suites is being built as a bootstrap-first business. No external funding will be sought until commercial traction validates the thesis. The hosted paid tier ships at v0 launch specifically to generate revenue from day one, extend runway, and produce the kind of paid-user signal that makes a future fundraise from a position of strength. A co-founder search is planned immediately following v0 launch.

## **2.5 Business model**

The OSS core is licensed under Apache 2.0. Self-hosted use is free and unrestricted. The hosted multi-tenant offering is licensed under BSL 1.1 and generates revenue through a base subscription plus at-cost usage passthrough. Enterprise self-hosted licenses with support contracts are a v1 motion.

# **3. Product Scope**

## **3.1 In scope (v0, four-week build)**

The v0 build comprises two artifacts: an open source self-hostable application for single-user local use, and a hosted multi-tenant SaaS deployment serving paying customers via per-team isolated Fly.io Machines behind a Cloudflare Workers gateway.

### **3.1.1 Core engine (shared between OSS and hosted)**

* Markdown-based document storage with structured YAML frontmatter metadata
* Document creation via natural language prompt, seeded by a library of built-in SOP templates
* Hybrid retrieval combining semantic embeddings and BM25 keyword search with citation back to source paragraphs
* Chatbot interface as the primary surface, with documents rendered in a side panel
* Agent tool surface: search\_documents, read\_document, list\_documents, create\_document, propose\_edit, find\_stale\_references
* Diff-based review of all proposed edits with explicit user approval before any change is committed
* Single-document edit-from-chat workflow demonstrating the agentic maintenance loop
* PDF export for any document
* Multi-provider model routing from launch, with cost-optimized dispatch across providers
* Local spend tracker recording cumulative model API cost per billing period
* Storage abstraction layer: same core code runs against SQLite (OSS) or SQLite volume on Fly.io (hosted)
* Auth abstraction layer: no-op single user (OSS) or Better-Auth magic link (hosted)

### **3.1.2 OSS self-host (v0)**

* Local-first storage with SQLite and markdown files on disk; no cloud dependency
* No authentication; single-user, single-machine
* User supplies own model API keys via environment variables
* Self-host installation via Docker Compose and single-binary alternative
* Public repository on day-one launch under Apache 2.0 license

### **3.1.3 Hosted SaaS (v0)**

* One isolated Fly.io Machine per team: separate container, separate SQLite volume, separate process
* Per-team subdomain: team-name.kayasuites.com via Cloudflare DNS wildcard
* Cloudflare Workers gateway: enforces entitlement and rate limits from KV before requests reach the Machine
* Passwordless magic-link authentication via Better-Auth within each Machine
* $10/month base subscription via Stripe; no free trial; 30-day money-back guarantee
* At-cost model token passthrough for usage above the included monthly allotment
* OSS backend tracks cumulative spend locally; signals CF KV and EE backend asynchronously when cap is reached
* EE backend is never in the request hot path; it handles provisioning, lifecycle, and notifications only
* Machine lifecycle: stop immediately on cancellation, destroy after 30-day grace period, package data for customer
* Stripe metered billing for overage reporting at end of each billing period
* Basic user dashboard: plan status, usage against limits, billing management link
* Account deletion and data export for GDPR compliance
* Commercial repo (EE layer) licensed under BSL 1.1, separate private repository

## **3.2 Explicitly out of scope (v0)**

* Realtime multi-user collaborative editing
* Multi-document batch update workflow (deferred to v0.5)
* Bring-your-own-key for hosted users (deferred to v0.5)
* Local model inference via Ollama for hosted users (OSS self-hosters may use Ollama)
* Microsoft Office format import or export
* Rich block-based editor beyond markdown
* Plugin or extension SDK
* Mobile applications or native desktop wrappers
* Spreadsheet and presentation surfaces
* Background or proactive agent monitoring
* Free tier or free trial
* OAuth providers for sign-in; magic link only at launch
* Tiered pricing plans, annual discounts, or team seat pricing
* SSO, SAML, or enterprise authentication
* Hosted demo environment

## **3.3 Planned for v0.5**

* Bring-your-own-key for hosted users
* Multi-document batch update workflow
* OAuth sign-in (Google, GitHub)
* Tiptap-based editor with markdown extensions
* Version history, rollback, and folder/subfolder file segregation
* Tag and folder organization
* Folder/subfolder file segregation with documents assignable to nested folders and files stored within a folder hierarchy
* Free tier with strict usage limits
* Annual pricing with discount

## **3.4 Planned for v1 (post-seed)**

* Realtime collaborative editing via CRDT (Yjs)
* Multi-user teams, workspaces, and granular permissions within a Machine
* Team and Enterprise hosted tiers
* Microsoft Office format compatibility
* Proactive agent: scheduled freshness reviews and stale-content detection
* Plugin and extension SDK with third-party tool ecosystem
* Audit logging, SSO, and enterprise admin features
* Expansion to spreadsheet and presentation surfaces at 500 paying subscribers

# **4. Target Users and Use Cases**

## **4.1 Primary persona, OSS self-host**

Technical founder or operations lead at a 10 to 50 person early-stage company. Comfortable self-hosting. Cares about data sovereignty and is suspicious of cloud-only AI tools. Willing to configure environment variables and run Docker Compose in exchange for a product that keeps their SOPs current.

## **4.2 Primary persona, hosted paid tier**

Technical founder, operations lead, or solo operator who recognizes the problem of stale documentation and is willing to pay $10/month for a fully managed, physically isolated instance. Values the fact that their team's data never shares a process or database with another customer. Motivated by the 30-day money-back guarantee to subscribe without a free trial.

## **4.3 Secondary personas (v1 and beyond)**

* Engineering team leads maintaining runbooks, post-mortems, and architecture documentation
* Operations and people leads maintaining SOPs, onboarding, and policy documents
* Privacy-sensitive organizations requiring self-hosted or physically isolated AI
* Regulated industries with documentation freshness compliance requirements
*

## **4.4 Anchoring use cases**

### **Use case 1: Generate a new SOP from a prompt**

The user describes a process in natural language. The agent produces a structured SOP using an appropriate template, populates sections, and saves the document with metadata. The user reviews and edits before the document is finalized.

### **Use case 2: Answer a question grounded in existing documents**

The user asks the chatbot a factual question about company processes. The agent retrieves relevant document chunks, synthesizes an answer, and cites the source documents and paragraphs. The user can click through to verify.

### **Use case 3: Edit an existing document via chat**

The user asks the chatbot to update a specific section of a specific document. The agent proposes a structured diff and waits for approval. The change is applied only after explicit user confirmation.

### **Use case 4: Subscribe and onboard to the hosted tier**

A new visitor subscribes via Stripe Checkout. The Enterprise backend provisions a Fly.io Machine, creates a subdomain, writes entitlement to CF KV, and sends a welcome email with the subdomain. The user reaches their isolated instance and completes onboarding in under 10 minutes.

### **Use case 5: Self-host installation from GitHub**

A self-hoster clones the OSS repo, configures their API key, and reaches a working state in under 15 minutes via Docker Compose. Cloudflare is not involved.

### **Use case 6: Spend cap reached mid-session**

A team's cumulative model spend crosses their monthly cap mid-session. The OSS backend records the threshold crossing in SQLite, asynchronously writes spend\_cap\_reached to CF KV, and asynchronously notifies the EE backend. Within seconds the CF Worker begins returning 429 responses to new agent invocations for that team. Non-agent requests (document viewing, chat history) continue to serve normally. The team receives an email notification from Resend explaining the cap and their options.



# **5. Functional Requirements**

M \= Must (v0). S \= Should (v0.5). C \= Could (v1 or later). Requirements FR-47 through FR-62 are new in v0.4 covering the gateway, provisioning, spend signalling, and Machine lifecycle.

| ID    | Category          | Requirement                                                                                                                                                                                                                                                                          | Priority |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| FR-1  | Document model    | Markdown with YAML frontmatter: title, owner, last\_reviewed, tags, related\_docs.                                                                                                                                                                                                   | M        |
| FR-2  | Document model    | Each document has a stable UUID independent of file path or title.                                                                                                                                                                                                                   | M        |
| FR-3  | Storage (OSS)     | Local SQLite and markdown files on disk. No cloud dependency.                                                                                                                                                                                                                        | M        |
| FR-4  | Storage (hosted)  | SQLite volume attached to the team's Fly.io Machine. Storage abstraction ensures same core code targets both modes.                                                                                                                                                                  | M        |
| FR-5  | Retrieval         | Hybrid retrieval: semantic vector search plus BM25. Ranked results with document and paragraph IDs.                                                                                                                                                                                  | M        |
| FR-6  | Retrieval         | Every retrieved chunk traceable to source document and paragraph with clickable citation.                                                                                                                                                                                            | M        |
| FR-7  | Generation        | Agent generates documents from natural language prompt, optionally guided by built-in template.                                                                                                                                                                                      | M        |
| FR-8  | Generation        | At least five built-in SOP templates at launch: onboarding, deployment runbook, incident response, vendor selection, offboarding.                                                                                                                                                    | M        |
| FR-9  | Chat interface    | Chatbot is primary UI. Document side panel renders alongside chat.                                                                                                                                                                                                                   | M        |
| FR-10 | Chat interface    | Chat sessions persisted per user and grouped by session.                                                                                                                                                                                                                             | S        |
| FR-11 | Agent tools       | Tool surface: search\_documents, read\_document, list\_documents, create\_document, propose\_edit, find\_stale\_references.                                                                                                                                                          | M        |
| FR-12 | Agent tools       | All tool invocations logged and inspectable in a transparency view.                                                                                                                                                                                                                  | S        |
| FR-13 | Edit workflow     | Agent never commits an edit without explicit user approval. Every proposed edit renders as a diff.                                                                                                                                                                                   | M        |
| FR-14 | Edit workflow     | User can modify a proposed change before accepting it.                                                                                                                                                                                                                               | S        |
| FR-15 | Edit workflow     | Multi-document updates present all proposed edits as a single reviewable batch.                                                                                                                                                                                                      | S        |
| FR-16 | Versioning        | Every accepted edit creates a version. Users can view history and roll back.                                                                                                                                                                                                         | S        |
| FR-17 | Export            | PDF export for any document.                                                                                                                                                                                                                                                         | M        |
| FR-18 | Export            | .docx export with reasonable fidelity.                                                                                                                                                                                                                                               | C        |
| FR-19 | Model layer       | Model calls route through a provider-agnostic abstraction. No code calls a provider SDK directly.                                                                                                                                                                                    | M        |
| FR-20 | Model layer       | Multi-provider routing active from launch. Fast cheap models for retrieval and classification; strong models for edit generation.                                                                                                                                                    | M        |
| FR-21 | Model layer       | OSS users configure own API keys via environment variables. Hosted users access managed keys.                                                                                                                                                                                        | M        |
| FR-22 | Model layer       | Bring-your-own-key for hosted users with per-task provider selection.                                                                                                                                                                                                                | S        |
| FR-23 | Model layer       | Ollama support for OSS self-host users.                                                                                                                                                                                                                                              | S        |
| FR-24 | Model layer       | Transparency view showing prompts, retrieved context, and tool definitions sent to model on each request.                                                                                                                                                                            | S        |
| FR-25 | Auth (OSS)        | OSS mode: no authentication, single-user, single-machine.                                                                                                                                                                                                                            | M        |
| FR-26 | Auth (hosted)     | Hosted mode: Better-Auth magic-link authentication within each team Machine.                                                                                                                                                                                                         | M        |
| FR-27 | Auth (hosted)     | OAuth sign-in via Google and GitHub.                                                                                                                                                                                                                                                 | S        |
| FR-28 | Auth (hosted)     | Account deletion with all data permanently removed within 30 days.                                                                                                                                                                                                                   | M        |
| FR-29 | Auth (hosted)     | Full data export as downloadable archive at any time.                                                                                                                                                                                                                                | M        |
| FR-30 | Billing           | Single paid tier at $10/month. No free trial. 30-day money-back guarantee.                                                                                                                                                                                                           | M        |
| FR-31 | Billing           | Stripe Checkout for signup. Stripe metered billing for overage. Stripe Customer Portal for self-service.                                                                                                                                                                             | M        |
| FR-32 | Billing           | Stripe webhooks drive all subscription state changes. Webhook processing is idempotent.                                                                                                                                                                                              | M        |
| FR-33 | Billing           | Overage model usage billed at cost with zero margin.                                                                                                                                                                                                                                 | M        |
| FR-34 | Billing           | Usage-based add-on tier or annual pricing.                                                                                                                                                                                                                                           | S        |
| FR-35 | Dashboard         | User dashboard: plan status, billing period, usage vs limits, Stripe Customer Portal link.                                                                                                                                                                                           | M        |
| FR-36 | Open source       | Core engine and OSS self-host app released under Apache 2.0 on day-one launch.                                                                                                                                                                                                       | M        |
| FR-37 | Open source       | EE layer (CF Worker config, EE backend, EE frontend) licensed under BSL 1.1 in a separate private repository.                                                                                                                                                                        | M        |
| FR-38 | Stale detection   | Agent identifies documents referencing an outdated entity given a hint from the user.                                                                                                                                                                                                | M        |
| FR-39 | Stale detection   | Proactive scheduled stale-content detection.                                                                                                                                                                                                                                         | C        |
| FR-40 | Collaboration     | Real-time collaborative editing via CRDT.                                                                                                                                                                                                                                            | C        |
| FR-41 | Collaboration     | Multi-user permissions within a team instance.                                                                                                                                                                                                                                       | C        |
| FR-42 | Gateway           | Cloudflare Worker intercepts all hosted requests before they reach the Fly.io Machine. The Worker reads CF KV and enforces entitlement: requests from teams without an active subscription receive a 402 response.                                                                   | M        |
| FR-43 | Gateway           | The Worker enforces per-team rate limits (hourly and daily agent invocation counts, TBD) from CF KV. Requests exceeding limits receive a 429 response.                                                                                                                               | M        |
| FR-44 | Gateway           | The Worker enforces the spend cap flag: if spend\_cap\_reached is true in KV for a team, new agent invocations receive a 429. Non-agent requests (document viewing, chat history, exports) are not blocked.                                                                          | M        |
| FR-45 | Gateway           | The Worker proxies all passing requests directly to the team's Fly.io Machine. The EE backend is never in the request hot path.                                                                                                                                                      | M        |
| FR-46 | DNS               | Each team is provisioned a subdomain of the form team-name.kayasuites.com via Cloudflare DNS. The subdomain is created by the EE backend calling the Cloudflare DNS API at provisioning time.                                                                                        | M        |
| FR-47 | Provisioning      | On a successful Stripe subscription event, the EE backend executes the provisioning sequence: (1) create Fly.io Machine, (2) wait for healthy state, (3) create CF DNS record, (4) write entitlement to CF KV, (5) send welcome email via Resend.                                    | M        |
| FR-48 | Provisioning      | Each provisioning step is retryable and idempotent. If a step fails, the sequence retries from that step without duplicating earlier work.                                                                                                                                           | M        |
| FR-49 | Provisioning      | Provisioning completion is confirmed to the user via a welcome email containing their team subdomain and onboarding instructions. Target provisioning time from Stripe webhook receipt to Machine healthy: under 60 seconds.                                                         | M        |
| FR-50 | Spend signalling  | The OSS backend maintains a local spend tracker in SQLite recording cumulative model API cost for the current billing period, updated after every model call.                                                                                                                        | M        |
| FR-51 | Spend signalling  | When cumulative spend crosses the monthly cap (TBD), the OSS backend fires two async signals without blocking the current response: (1) write spend\_cap\_reached: true to CF KV for the team; (2) notify the EE backend via an async HTTP call.                                     | M        |
| FR-52 | Spend signalling  | The EE backend, on receiving a spend-cap notification, sends the team an alert email via Resend and logs the event for billing reconciliation.                                                                                                                                       | M        |
| FR-53 | Spend signalling  | The OSS backend resets the spend tracker and clears the CF KV spend\_cap\_reached flag at the start of each new billing period. The EE backend triggers this reset via a webhook or scheduled call at period rollover.                                                               | M        |
| FR-54 | Spend signalling  | The spend tracker is recoverable. If a Machine restarts mid-period, the spend tracker is restored from SQLite, not reset to zero.                                                                                                                                                    | M        |
| FR-55 | Machine lifecycle | On subscription cancellation (Stripe customer.subscription.deleted webhook), the EE backend stops the team's Fly.io Machine immediately. Data is preserved. The team's CF KV entitlement is set to inactive, blocking gateway access.                                                | M        |
| FR-56 | Machine lifecycle | The stopped Machine enters a 30-day grace period. During this period the Machine remains stopped and the data volume is preserved. The team can resubscribe and have their Machine restarted with all data intact.                                                                   | M        |
| FR-57 | Machine lifecycle | After the 30-day grace period expires with no resubscription, the EE backend destroys the Fly.io Machine, packages the SQLite volume as a downloadable archive, and emails a download link to the team owner. The archive is retained for a further 7 days then permanently deleted. | M        |
| FR-58 | Machine lifecycle | Machine sleep: Fly.io Machines are configured to sleep after a configurable period of inactivity (TBD, default 30 minutes) and wake on incoming traffic. This reduces hosting cost for infrequent-use teams.                                                                         | M        |
| FR-59 | Machine lifecycle | Machine wake latency: the CF Worker adds a retry-after mechanism for requests that arrive while a Machine is waking. The user experience is a brief loading state, not an error.                                                                                                     | M        |
| FR-60 | Observability     | The EE backend maintains an operational dashboard showing: active Machine count, aggregate model spend, per-team spend, CF KV entitlement state, provisioning queue status, and any failed provisioning sequences.                                                                   | M        |
| FR-61 | Observability     | Failed provisioning sequences generate an alert to the founder. Partial provisioning state is logged for manual remediation.                                                                                                                                                         | M        |
| FR-62 | Observability     | CF KV entitlement state is reconciled against Stripe subscription state on a scheduled basis (every hour) to detect and correct any drift from missed webhooks.                                                                                                                      | M        |

# **6. Non-Functional Requirements**

## **6.1 Performance**

* Document creation from prompt completes in under 30 seconds for a typical SOP under 1,500 words.
* Search and retrieval results return in under 500 milliseconds for a corpus of up to 1,000 documents.
* CF Worker entitlement check adds under 5 milliseconds of latency to each request (KV read at edge).
* Machine wake latency (cold start from sleep): under 2 seconds. Worker retry-after mechanism masks this from the user.
* Provisioning from Stripe webhook to Machine healthy: under 60 seconds.
* Spend-cap signal propagation from OSS backend write to CF Worker enforcing the flag: under 60 seconds (CF KV eventual consistency window).

## **6.2 Reliability**

* No edit is ever committed without explicit user approval, even in the presence of crashes or model timeouts.
* The EE backend is never in the request hot path. Its failure does not affect request serving for active teams.
* CF Worker failure returns a 503. It does not grant access to unauthenticated or unpaid teams.
* Provisioning sequences are retryable and idempotent (FR-48). No partial provisioning state results in a broken Machine.
* Stripe webhook processing is idempotent. Duplicate delivery does not cause duplicate provisioning or billing events.
* Spend tracker is persisted in SQLite and recoverable across Machine restarts (FR-54).
* Hosted version targets 99% uptime in v0. No formal SLA is offered.

## **6.3 Privacy and security**

* Each team's data is physically isolated in a separate Fly.io Machine with a separate SQLite volume. No shared application state between teams at the process or database layer.
* CF KV stores entitlement metadata only (subscription status, rate counters, spend flag). No document content or user PII is stored in KV.
* OSS mode stores all data locally. No telemetry without explicit opt-in.
* Hosted mode encrypts data in transit. Fly.io volume encryption at rest where available.
* Master API keys and Fly.io API tokens stored as platform secrets, never logged.
* GDPR-compliant data export and account deletion per FR-29 and FR-28.
* On Machine destruction, customer data is packaged and made available for download for 7 days then permanently deleted (FR-57).

## **6.4 Cost control**

* Per-team monthly model spend cap enforced by the OSS backend spend tracker (TBD value). CF KV flag blocks further agent invocations when cap is reached.
* Machine sleep reduces hosting cost for infrequent-use teams (FR-58).
* Founder operational dashboard provides real-time aggregate and per-team cost visibility (FR-60).
* Global circuit breaker in the EE backend pauses new provisioning if aggregate daily model spend across all Machines exceeds a configured emergency threshold.

## **6.5 Consistency**

* CF KV is eventually consistent with a propagation window of up to 60 seconds globally. This means: a newly activated subscription may take up to 60 seconds to become accessible; a spend cap flag may take up to 60 seconds to propagate to all edge nodes.
* The 60-second window is acceptable for a $10/month product. A cancelled team may retain access for up to 60 seconds after KV update. A newly subscribed team may wait up to 60 seconds before their first request passes the Worker.
* Hourly reconciliation (FR-62) detects and corrects any drift between KV state and Stripe subscription state caused by missed or delayed webhooks.

## **6.6 Accessibility**

* Keyboard navigation covers all primary user flows at v0 launch.
* WCAG 2.1 AA compliance is a v1 target.

## **6.7 Compatibility**

* v0 is a web application targeting modern Chromium-based browsers, Firefox, and Safari.
* OSS storage uses open standards (markdown, SQLite) readable by external tools.

# **7. User Experience Principles**

1. Chat is the primary surface. Documents render alongside chat.
2. The agent is transparent. Every retrieval, tool call, and proposed change is visible and inspectable.
3. Edits require approval. The agent never silently modifies content.
4. Citations are non-negotiable. Every factual claim points to a verifiable source paragraph.
5. Local-first by default in OSS mode. Cloud features are opt-in.
6. Markdown is the lingua franca. Raw markdown is always accessible and portable.
7. OSS is not crippled. The paid hosted tier sells physical isolation and managed infrastructure, not gated features.
8. Billing is honest. Cancellation is one click. The money-back guarantee is unconditional. No dark patterns.
9. Overages are predictable. Users always know their current spend before they are surprised by a bill.
10. Gateway errors are informative. A 402 from the Worker explains how to resubscribe. A 429 for spend cap explains what happened and what to do next.
11. Machine wake is seamless. A brief loading state replaces an error when a sleeping Machine is waking.
12. Reduce, don't add. Each new capability must serve an anchoring use case.

# **8. Technical Constraints and Assumptions**

## **8.1 Committed architectural decisions**

* Markdown with YAML frontmatter is the canonical document representation.
* Storage is abstracted behind a common interface. SQLite in OSS mode; SQLite volume on Fly.io Machine in hosted mode.
* Auth is abstracted behind a common interface. No-op in OSS mode; Better-Auth in hosted mode.
* Model layer is a provider-agnostic abstraction. No application code calls a provider SDK directly.
* Multi-provider routing is active from launch with a configurable cost-optimized routing table.
* All edits flow through a propose-then-approve pattern.
* Citations are first-class throughout the retrieval and generation pipeline.
* The EE backend is never in the request hot path. It handles provisioning, lifecycle, and async notifications only.
* Entitlement and rate limits are enforced at the Cloudflare Worker layer, not in the OSS application.
* Spend caps are tracked by the OSS backend and signalled outward asynchronously. The OSS application does not call the EE backend synchronously.
* Each paying team receives one completely isolated Fly.io Machine: separate container, process, and SQLite volume.

## **8.2 Technology stack**

| Concern           | Choice                                                      | Rationale                                                                            |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Concern           | Choice                                                      | Rationale                                                                            |
| Framework         | Next.js 15, app router, TypeScript                          | Best AI tooling support; one-click Vercel or Fly deploy                              |
| OSS storage       | SQLite via better-sqlite3, sqlite-vec for vectors           | Zero-dependency local storage; file-portable                                         |
| Hosted storage    | SQLite volume on Fly.io Machine, sqlite-vec for vectors     | Same codebase as OSS; physical isolation per team                                    |
| ORM               | Drizzle                                                     | Single schema targeting SQLite in both modes; type-safe; lightweight                 |
| Auth              | Better-Auth                                                 | OSS-licensed, Drizzle-compatible, magic link support, no per-MAU vendor cost         |
| Billing           | Stripe Checkout and Stripe metered billing                  | Hosted checkout removes PCI surface; metered billing handles at-cost passthrough     |
| Email             | Resend                                                      | Clean API; reliable deliverability; free tier covers early volume                    |
| Gateway           | Cloudflare Workers                                          | Edge-deployed, zero infrastructure to operate, scales to zero, billed per request    |
| Entitlement store | Cloudflare KV                                               | Edge-local reads sub-millisecond; eventual consistency acceptable for this use case  |
| DNS               | Cloudflare DNS                                              | Wildcard cert for \*.kayasuites.com; programmatic record creation via API            |
| Compute (hosted)  | Fly.io Machines                                             | Programmable containers via API; fast boot; sleep/wake on traffic; isolated per team |
| OSS deployment    | Docker Compose, single-binary Next.js standalone            | Lowest-friction self-host path                                                       |
| Model routing     | Custom provider abstraction with configurable routing table | Dispatches by task type and cost; Claude, OpenAI, Groq supported at launch           |

## **8.3 Model routing table**

| Operation                         | Model tier                                              | Rationale                                               |
| --------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| Operation                         | Model tier                                              | Rationale                                               |
| Retrieval and classification      | Fast, low-cost (e.g. Claude Haiku, GPT-4o mini)         | High frequency, low stakes; cost dominates              |
| Document generation               | Strong (e.g. Claude Sonnet)                             | Output quality directly affects user trust              |
| Edit proposal and diff generation | Strong (e.g. Claude Sonnet)                             | Most critical operation; accuracy paramount             |
| Stale reference detection         | Fast model                                              | Broad scan over many documents; cost scales with corpus |
| Embedding generation              | Dedicated embedding model (e.g. text-embedding-3-small) | Specialized for retrieval; not a chat model task        |

## **8.4 Constraints**

* Solo founder. Four-week build window.
* No paid design resources for v0.
* Founder bears model API costs and Fly.io Machine costs until MRR offsets them.
* Three TBD values must be decided before v0 ships: included monthly agent invocation allotment (D-12), per-user storage cap (D-13), and per-user monthly model spend cap (D-14). These require cost modeling against the $10 base.
* The provisioning sequence (FR-47, FR-48) is the most complex engineering task in v0 and should be built and tested first, before the OSS application is feature-complete, to surface reliability issues early.

# **9. Success Metrics**

## **9.1 v0 launch (first 30 days)**

* Public launch on Hacker News plus at least one secondary venue.
* 500 GitHub stars on the OSS repository.
* 100 confirmed self-host installations.
* 50 hosted-tier paying subscribers, each with a provisioned Fly.io Machine.
* $500 MRR from hosted subscriptions.
* Zero provisioning failures that required manual remediation.
* Zero unintended data access events across team boundaries.

## **9.2 v0.5 (90 days post-launch)**

* 200 paying hosted subscribers.
* $2,000 MRR.
* Monthly churn under 8%.
* Unit economics positive: average revenue per team exceeds average model cost plus Fly.io Machine cost per team.
* At least 3 case studies from organizational users.

## **9.3 Suite expansion trigger**

Kaya Suites evaluates expansion to spreadsheet and presentation surfaces when: (1) 500 paying hosted subscribers, and (2) at least one subscriber has explicitly requested a spreadsheet or presentation surface. Both conditions must be true simultaneously.

## **9.4 Venture funding trigger**

External venture funding is explored when: (1) MRR demonstrates consistent growth over at least three consecutive months, (2) the suite expansion trigger has been reached, and (3) at least one prospective co-founder has been identified through the post-v0 search process.

# **10. Risks and Mitigations**

| ID   | Risk                     | Description                                                                                                                                  | Mitigation                                                                                                                                                             |
| ---- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Agent reliability        | The model proposes edits that miss context or hallucinate facts.                                                                             | Propose-then-approve UX. Diff review required. Heavy prompt engineering. Strong models for all edit operations.                                                        |
| R-2  | Provisioning reliability | The provisioning sequence fails mid-way, leaving a team with a broken or inaccessible Machine.                                               | Idempotent retryable steps (FR-48). Operational alerts on failure (FR-61). Manual remediation runbook prepared before launch.                                          |
| R-3  | Crowded category         | Notion AI, Mem, Glean, and Danswer occupy adjacent space.                                                                                    | Lead with agentic maintenance and physical data isolation. Target technical and privacy-sensitive early adopters.                                                      |
| R-4  | Timeline slip            | Four-week solo build with SaaS infrastructure, gateway, and provisioning is aggressive.                                                      | Five-week private buffer. Provisioning built and tested first. Managed services for all infrastructure. Time-box any component exceeding two days.                     |
| R-5  | Cold payment conversion  | Asking users to pay $10 with no trial requires confidence. Conversion may be weak at launch.                                                 | 30-day money-back guarantee as risk reversal. OSS self-host as the free evaluation path. Demo video on landing page.                                                   |
| R-6  | Unit economics           | At-cost token passthrough means the $10 base must cover Fly.io Machine cost plus infrastructure. Heavy users may make accounts unprofitable. | Hard monthly spend cap (FR-51). Machine sleep for cost reduction (FR-58). TBD limits require cost modeling before launch.                                              |
| R-7  | KV consistency window    | CF KV eventual consistency means a cancelled team may retain access for up to 60 seconds.                                                    | Accepted risk for $10/month product. Hourly reconciliation (FR-62) detects drift. Documented in terms of service.                                                      |
| R-8  | Machine cold wake        | A sleeping Machine may add up to 2 seconds of latency for infrequent users.                                                                  | Worker retry-after mechanism (FR-59) presents a loading state rather than an error. Sleep timeout tuned to balance cost and latency.                                   |
| R-9  | Metered billing          | Stripe metered billing is more complex than flat subscriptions. Errors in usage reporting could under- or over-bill.                         | Usage events logged in SQLite independently before reporting to Stripe. Idempotent reporting. Reconciliation on billing period close.                                  |
| R-10 | Operational burden       | Operating a paid SaaS with per-team Machines solo imposes ongoing support, security, and reliability responsibilities.                       | All infrastructure managed (Fly.io, Cloudflare, Stripe, Resend). Operational dashboard (FR-60). 24-hour support response target. Co-founder search begins post-launch. |
| R-11 | Bootstrap runway         | Without external funding, runway is constrained to personal savings plus MRR.                                                                | Hosted-tier revenue from day one. Lean cost structure with Machine sleep. Clear MRR milestones for fundraising trigger.                                                |
| R-12 | License confusion        | Mixed Apache 2.0 and BSL 1.1 across two repositories could confuse contributors.                                                             | Clear LICENSE files. README documents dual-license structure prominently. Legal counsel before launch.                                                                 |
| R-13 | Founder burnout          | Solo founder shipping SaaS infrastructure, gateway, and agent reliability in four weeks.                                                     | Realistic four-week public timeline with five-week buffer. Prototype framing at launch. Co-founder search immediately post-launch.                                     |

# **11. Decisions Log**

All open questions from prior drafts resolved. New decisions D-15 through D-21 added in v0.4 covering the gateway and infrastructure architecture.

| ID   | Decision             | Resolution                                                                                                                                            | Rationale                                                                                                     |
| ---- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| D-1  | Product name         | Kaya Suites                                                                                                                                           | Founder decision.                                                                                             |
| D-2  | OSS core license     | Apache 2.0                                                                                                                                            | Maximum community adoption. Core engine is the funnel, not the moat.                                          |
| D-3  | Commercial license   | BSL 1.1, converting to Apache 2.0 after four years                                                                                                    | Protects hosted tier from hyperscaler competition. Follows MariaDB and Sentry precedent.                      |
| D-4  | Repository structure | Two repositories: public OSS repo (Apache 2.0), private commercial repo (BSL 1.1)                                                                     | Clean license separation. Commercial repo imports OSS core as a dependency.                                   |
| D-5  | Pricing model        | $10/month base with at-cost token passthrough for overages. Zero margin on overages.                                                                  | Low entry price. At-cost passthrough aligns incentives with users.                                            |
| D-6  | Trial model          | No free trial. 30-day unconditional money-back guarantee.                                                                                             | Filters for higher-intent users. Simpler billing than trial logic. Signals product confidence.                |
| D-7  | Hosted demo          | No hosted demo. OSS self-host is the free evaluation path.                                                                                            | Reduces v0 scope. OSS evaluation serves privacy-conscious primary persona.                                    |
| D-8  | Model routing        | Multi-provider from launch with cost-optimized dispatch table.                                                                                        | Core to AI-agnostic positioning. Fast models for high-frequency ops; strong models for edits.                 |
| D-9  | Co-founder search    | Begins immediately after v0 launch.                                                                                                                   | Live product is the best recruiting asset.                                                                    |
| D-10 | Funding strategy     | Bootstrap until traction. Raise on strength once suite expansion trigger is reached.                                                                  | Better terms, stronger position, more founder control than raising pre-traction.                              |
| D-11 | Suite expansion      | 500 paying subscribers AND at least one has requested a new surface.                                                                                  | Prevents premature expansion while keeping focus on commercial validation.                                    |
| D-12 | Included invocations | TBD: requires cost modeling against $10 base before v0 ships.                                                                                         | Must ensure unit economics positive at median usage.                                                          |
| D-13 | Storage cap          | TBD: unlimited documents, storage capped at a value to be determined.                                                                                 | Must balance user experience against Fly.io volume cost at scale.                                             |
| D-14 | Monthly spend cap    | TBD: hard cap per team on model API spend per billing period.                                                                                         | Must protect economics without frustrating power users.                                                       |
| D-15 | Gateway runtime      | Cloudflare Workers                                                                                                                                    | Zero infrastructure, edge-deployed, scales to zero, billed per request, no ops burden for solo founder.       |
| D-16 | Entitlement store    | Cloudflare KV                                                                                                                                         | Edge-local reads; sub-millisecond latency; 60-second consistency window acceptable for $10/month product.     |
| D-17 | Compute platform     | Fly.io Machines                                                                                                                                       | Programmable via API; fast boot; sleep/wake on traffic; designed for isolated per-tenant containers.          |
| D-18 | Team routing         | Per-team subdomains: team-name.kayasuites.com via Cloudflare DNS wildcard                                                                             | Premium feel; standard pattern (Vercel, Railway); DNS managed programmatically via CF API.                    |
| D-19 | Instance isolation   | One completely isolated Fly.io Machine per team: separate container, process, and SQLite volume.                                                      | Strongest possible data isolation story. No cross-team leakage risk at application layer.                     |
| D-20 | Spend enforcement    | OSS backend tracks spend locally and signals CF KV and EE backend asynchronously when cap is reached. EE backend never in request hot path.           | Resilient: EE backend failure does not affect request serving. Accurate: OSS backend knows exact token costs. |
| D-21 | Machine lifecycle    | Stop immediately on cancellation. Destroy after 30-day grace. Package SQLite volume for customer. Download link valid 7 days then permanent deletion. | Protects customer data. Provides resubscription path. Clean permanent deletion after grace period.            |

# **12. Commercial Architecture**

## **12.1 System overview**

Kaya Suites hosted infrastructure comprises four layers. Each layer has a distinct responsibility and is designed so that the failure of any one layer does not cascade to others.

| Layer                    | Components                                                           | Responsibility                                                                                                                  | Failure impact                                                          |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Layer                    | Components                                                           | Responsibility                                                                                                                  | Failure impact                                                          |
| User                     | Browser, team subdomain                                              | Initiates requests to team.kayasuites.com                                                                                       | User-local; no system impact                                            |
| Cloudflare edge          | CF DNS, CF Workers, CF KV                                            | Resolves subdomain, enforces entitlement and rate limits, proxies passing requests, reads spend-cap flag                        | 503 returned to user; Machine unaffected                                |
| Fly.io Machines          | OSS frontend, OSS backend, Better-Auth, SQLite volume, spend tracker | Serves the product to authenticated team users; tracks cumulative model spend; signals KV and EE backend async when cap reached | Single team affected; other teams unaffected; EE backend unaffected     |
| Enterprise control plane | EE frontend, EE backend, Stripe, Resend                              | Provisioning, lifecycle management, subscription event handling, spend notifications, operational observability                 | Request serving continues for all active teams; new provisioning pauses |

## **12.2 Repository structure**

| Repository                  | License    | Contents                                                                                                                                                                                      |
| --------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kaya-suites (public)        | Apache 2.0 | Core engine, agent loop, retrieval pipeline, model abstraction, spend tracker, storage interface, auth interface, OSS self-host app, Docker Compose, docs                                     |
| kaya-suites-cloud (private) | BSL 1.1    | CF Worker gateway code, EE backend (provisioning orchestrator, Stripe webhook handler, spend notification receiver, operational dashboard), EE frontend (billing UI, subscription management) |

## **12.3 Request flow (normal, active subscription)**

1. User navigates to team-name.kayasuites.com.
2. Cloudflare DNS resolves the subdomain to the CF Worker.
3. CF Worker reads CF KV for the team: checks entitlement (active), rate limit counters (within limits), and spend\_cap\_reached flag (false).
4. All checks pass. Worker proxies the request to the team's Fly.io Machine.
5. OSS backend on the Machine processes the request, makes model calls if needed, records token cost in the local spend tracker.
6. Response is returned to the user. The EE backend is not involved at any point.

## **12.4 Request flow (spend cap reached)**

1. OSS backend completes a model call. Spend tracker crosses the monthly cap threshold.
2. OSS backend fires two async signals without blocking the current response: (a) writes spend\_cap\_reached: true to CF KV; (b) sends an async HTTP notification to the EE backend.
3. Within up to 60 seconds, the CF Worker reads the updated KV flag. Subsequent agent invocations for that team receive a 429 with an informative message. Non-agent requests continue normally.
4. EE backend receives the notification, sends a spend-cap alert email via Resend to the team owner, and logs the event for billing reconciliation.
5. At the start of the next billing period, the EE backend triggers a spend reset: OSS backend clears its spend tracker in SQLite, EE backend clears the spend\_cap\_reached flag in CF KV.

## **12.5 Provisioning flow (new subscriber)**

1. User completes Stripe Checkout. Stripe fires customer.subscription.created webhook to the EE backend.
2. EE backend calls the Fly.io API to create a new Machine for the team using the latest OSS Docker image. Each step is logged for idempotent retry.
3. EE backend polls for Machine healthy state. On healthy, proceeds to next step.
4. EE backend calls the Cloudflare DNS API to create an A record for team-name.kayasuites.com pointing to the Machine's IP.
5. EE backend writes the team's entitlement entry to CF KV: { status: active, plan: base, spend\_cap\_reached: false, rate\_counters: 0 }.
6. EE backend calls Resend to send the team a welcome email with their subdomain and onboarding instructions.
7. Provisioning complete. Target elapsed time from webhook receipt: under 60 seconds.

## **12.6 Machine lifecycle**

| Event                                            | EE backend action                                                     | CF KV update               | Machine state                                 |
| ------------------------------------------------ | --------------------------------------------------------------------- | -------------------------- | --------------------------------------------- |
| Event                                            | EE backend action                                                     | CF KV update               | Machine state                                 |
| Subscription activated                           | Create Machine, create DNS record, send welcome email                 | status: active             | Running                                       |
| No traffic for idle period (TBD)                 | None (Fly.io handles automatically)                                   | No change                  | Sleeping                                      |
| Request arrives for sleeping Machine             | None (Worker retry-after, Fly.io wakes Machine)                       | No change                  | Waking then running                           |
| Spend cap reached                                | Send alert email via Resend, log event                                | spend\_cap\_reached: true  | Running (agent invocations blocked at Worker) |
| Billing period resets                            | Trigger spend tracker reset on Machine                                | spend\_cap\_reached: false | Running                                       |
| Subscription cancelled                           | Stop Machine immediately                                              | status: inactive           | Stopped (data preserved)                      |
| Grace period expires (30 days post-cancellation) | Destroy Machine, package SQLite volume, send download link via Resend | status: destroyed          | Destroyed                                     |
| Download link expires (7 days post-destruction)  | Permanently delete packaged data                                      | No change                  | Destroyed                                     |
| Customer resubscribes within grace period        | Restart stopped Machine                                               | status: active             | Running (all data intact)                     |

## **12.7 Billing flow**

1. User enters card details via Stripe Checkout. Stripe creates a subscription at $10/month.
2. Stripe fires customer.subscription.created. EE backend begins provisioning sequence (Section 12.5).
3. During the billing period, the OSS backend on each Machine records model token costs in its local spend tracker.
4. At end of billing period, EE backend reads each Machine's spend tracker and reports overage usage to Stripe metered billing. Stripe calculates any overage charge (at cost, zero margin) and issues an invoice.
5. On invoice.paid, EE backend confirms active status in KV and triggers spend tracker reset.
6. On invoice.payment\_failed, EE backend sends notification via Resend and enters a grace period before revoking access.
7. On money-back guarantee request within 30 days, founder issues full refund via Stripe. EE backend stops Machine immediately and begins cancellation lifecycle.

## **12.8 Entitlement reconciliation**

CF KV is the runtime entitlement store. Stripe is the source of truth. A scheduled reconciliation job runs hourly in the EE backend to detect and correct drift between KV state and Stripe subscription state. Drift can occur if a Stripe webhook is missed, delayed, or delivered out of order. The reconciliation job reads all active subscriptions from Stripe, compares to KV entries, and corrects any mismatches. Discrepancies trigger an operational alert to the founder.

## **12.9 Operational responsibilities (solo phase)**

* Daily: review EE backend operational dashboard (FR-60) for Machine health, aggregate spend, and any failed provisioning sequences.
* Weekly: review Stripe webhook delivery logs, failed payment queue, and per-team unit economics.
* Monthly: verify Fly.io volume backup restore procedure. Review reconciliation job logs for drift events.
* Ongoing: 24-hour support response. GDPR requests within 30 days. Security patches within 30 days of disclosure.

# **13. Pricing and Monetization**

## **13.1 Pricing structure**

| Tier           | Price                | License    | What is included                                                                                                                                       |
| -------------- | -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tier           | Price                | License    | What is included                                                                                                                                       |
| OSS self-host  | Free                 | Apache 2.0 | Full feature set. User supplies own model API keys. No support SLA. No Fly.io Machine; user provides their own compute.                                |
| Hosted base    | $10/month per team   | BSL 1.1    | Isolated Fly.io Machine, managed model access, team subdomain, 30-day money-back guarantee. Includes allotment of agent invocations and storage (TBD). |
| Hosted overage | At cost, zero margin | BSL 1.1    | Model token usage above included monthly allotment, billed at provider API cost via Stripe metered billing.                                            |

## **13.2 Included allotments (TBD)**

* **Agent invocations:** TBD per month. Above this, at-cost token passthrough applies.
* **Storage:** Unlimited documents. SQLite volume capped at TBD GB.
* **Monthly spend cap:** Hard cap at TBD per team per month. Agent invocations blocked above this cap.

## **13.3 What the hosted tier sells**

* Physically isolated Fly.io Machine per team. No shared state with other customers.
* Managed model access. No need to obtain or fund API keys.
* Managed infrastructure. Zero setup, automatic updates, Fly.io volume backups.
* Team subdomain. Accessible from any browser on any device.
* Direct email support from the founder during business hours.

## **13.4 Revenue targets**

| Milestone                  | Target                                                                     | Notes                                                                   |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Milestone                  | Target                                                                     | Notes                                                                   |
| End of v0 launch month     | $500 MRR                                                                   | 50 paying teams at $10                                                  |
| End of v0.5 (90 days)      | $2,000 MRR                                                                 | 200 paying teams                                                        |
| Suite expansion trigger    | 500 paying teams                                                           | Minimum for evaluating expansion to spreadsheet or presentation surface |
| Venture funding evaluation | Sustained MRR growth over 3+ consecutive months plus suite trigger reached | Raise from strength                                                     |

## **13.5 Refund and cancellation policy**

* 30-day unconditional money-back guarantee for new subscribers. Refund issued within 5 business days.
* Cancellation at any time via Stripe Customer Portal. Machine stopped immediately. Data preserved for 30-day grace period.
* Resubscription within grace period restarts the Machine with all data intact.
* After 30-day grace period, Machine destroyed, data packaged and emailed as a download link valid for 7 days.
* No prorated refunds for partial months after the 30-day guarantee window.

# **14. Glossary**

* **Agent:** A reasoning loop in which a language model selects and invokes tools, observes results, and continues until a task is complete or escalated to the user.
* **Apache 2.0:** A permissive open source license allowing use, modification, and distribution in proprietary products, with patent grant and attribution requirements.
* **BSL 1.1:** Business Source License version 1.1. A source-available license that prohibits competitive commercial use for a defined period (four years in this project) before converting to Apache 2.0.
* **CF KV:** Cloudflare Workers KV. A globally distributed key-value store readable at the edge by Cloudflare Workers with eventual consistency and a propagation window of up to 60 seconds.
* **CF Worker:** A Cloudflare Worker. A serverless function running at Cloudflare's edge that intercepts requests before they reach the origin server. Used in Kaya Suites as the API gateway for entitlement and rate limit enforcement.
* **Fly.io Machine:** An isolated container managed by the Fly.io platform, programmable via API. Used in Kaya Suites to provide one physically isolated compute and storage environment per paying team.
* **Machine lifecycle:** The sequence of states a Fly.io Machine passes through from provisioning (on subscription) through active service, sleep, spend-cap blocking, cancellation stop, grace period, and destruction.
* **Magic link:** A passwordless authentication pattern in which the user receives a single-use URL via email that authenticates them on click.
* **Metered billing:** A Stripe billing pattern in which usage is reported at the end of each billing period and charged based on actual consumption.
* **MRR:** Monthly Recurring Revenue. Subscription revenue normalized to a monthly basis.
* **OSS-core:** A business model in which a permissively licensed open source product forms the foundation, with proprietary extensions and a hosted offering generating revenue.
* **Provisioning sequence:** The ordered set of API calls the EE backend executes to bring a new team's hosted environment to a ready state: create Fly.io Machine, wait for healthy state, create CF DNS record, write CF KV entitlement, send welcome email.
* **RAG:** Retrieval-Augmented Generation. A pattern in which a model is grounded in retrieved context from a corpus rather than relying solely on parametric knowledge.
* **Spend tracker:** A SQLite table within each team's Fly.io Machine that records cumulative model API cost for the current billing period, updated after every model call.
* **SOP:** Standard Operating Procedure. A documented process describing how a recurring organizational activity is performed.
* **Webhook:** An HTTP callback delivered by a third-party service to notify the application of an event.

# **15. Revision History**

| v0.1 | May 2026. Initial draft. OSS-only v0 scope, two-week timeline.                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.2 | May 2026. Added hosted paid tier to v0 scope. Auth, billing, multi-tenancy. Four-week timeline. Sections 14 and 15 added.                                                                                                                                                                                                                                                                                                           |
| v0.3 | May 2026. All open questions resolved. Kaya Suites named. Apache 2.0 + BSL 1.1 licensing confirmed. $10/month + at-cost overage pricing. 30-day money-back guarantee. Bootstrap-first funding strategy. Suite expansion trigger at 500 subscribers. Decisions log added. Pricing section rewritten.                                                                                                                                 |
| v0.4 | May 2026. Architecture finalized. Section 12 fully rewritten: Cloudflare Workers gateway, CF KV entitlement store, per-team isolated Fly.io Machines, per-team subdomains, async spend-cap signalling, Machine lifecycle with 30-day grace period. FR-42 through FR-62 added. NFRs updated for KV consistency window and Machine wake latency. Decisions D-15 through D-21 added. Layer failure impact table added in Section 12.1. |