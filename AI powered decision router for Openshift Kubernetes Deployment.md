---
title: AI powered decision router for Openshift/Kubernetes Deployment
created: 2026-09-25
updated: 2026-09-25
type: summary
tags: [ai, laya, mcp, hermes, kubernetes, openshift, deployment, automation]
sources:
  - decision-router/README.md
  - decision-router/src/platform-schemas.ts
  - decision-router/AGENTS.md
confidence: high
---

# AI powered decision router for Openshift/Kubernetes Deployment

**Laya** is a typed decision model that evaluates structured choices, scores, and yes/no questions from supplied state. Instead of generating an unconstrained explanation, it returns a selected outcome with probability and confidence information. In this project, Laya is used to route deployment work: it selects the next evidence-gathering, build, apply, verification, diagnosis, or escalation step.

Deploying an application is rarely one command. Operators must identify the target platform, verify context and permissions, choose an image-delivery path, validate manifests, monitor rollout health, and prove that the published service works. The decision router turns the routing part of that workflow into a local Model Context Protocol (MCP) capability for Hermes.

It combines a Node.js MCP server with the Laya decision runtime. Hermes can call structured Laya tools to select the safest next workflow step for either Kubernetes or OpenShift, while existing deployment skills and human approval still govern all state-changing actions.

## What is Laya?

Laya is an open-source, non-autoregressive System 1 decision model from Convai Innovations, released under Apache 2.0. Rather than generating text like an LLM, it accepts a state—such as a ticket, email, JSON object, or other text—together with typed questions and returns typed answers with calibrated probabilities in a single forward pass.

Its three question primitives are:

- `choice`: select one option from a defined set.
- `score`: return a numeric or ordered rating.
- `noul`: return a yes/no probability.

Laya is trained with RLCD (Reinforcement Learning for Calibrated Decisions) against strictly proper scoring rules, incentivizing it to report honest probabilities. It never generates free-form text, so its outputs do not require text parsing and avoid text-generation hallucination risk. The router selects the appropriate checkpoint for each request automatically.

Fine-tuning is required for production-quality accuracy. The base English checkpoint scores 0.362 on the typed-decisions benchmark, while the fine-tuned checkpoint reaches 0.766, exceeding TypeSafe Jev's reported 0.727 score.

## Architecture diagram

![[assets/hermes-laya-decision-router-architecture.png|Hermes, Laya, Kubernetes, and OpenShift decision-routing architecture]]

The diagram shows Hermes consulting Laya through the MCP wrapper, recording a sanitized decision event, and entering only the confidence-gated Kubernetes or OpenShift workflow branch. The interactive Archify artifact is available in the project repository: [Hermes + Laya Deployment Decision Router](https://github.com/sandfleet/decision-router/blob/main/docs/hermes-laya-cluster-routing.architecture.html).

## Deployment assumptions

This reference setup assumes the following are installed and available locally:

- A Kubernetes cluster and client, such as kind with `kubectl`.
- An OpenShift or OKD cluster and client, such as CRC with `oc`.
- Hermes Agent as the LLM harness and MCP client.
- The Laya MCP wrapper and a reachable local `laya-serve` runtime.

The project does not install, start, or authenticate those components implicitly. It discovers and verifies them before deployment work begins.

## Reusable LLM instruction layer

The project also needs reusable, Karpathy's LLM Wiki-style skill Markdown files for each operational technique it supports. A deployment technique is not only code or a shell command: it needs a compact, source-backed instruction file that an LLM can load before acting.

For example, Kubernetes and OpenShift deployment skills define the evidence to collect, the image and manifest checks to perform, the platform-specific rollout workflow, the failure diagnostics to inspect, and the conditions required before reporting success. The same pattern can be used for any future technique, such as image delivery, Route verification, incident diagnosis, rollback, or deployment review.

These skills are portable instruction artifacts. Any LLM harness that can read Markdown can use them to follow a repeatable workflow instead of inventing commands or treating a successful `apply` operation as proof of a healthy deployment. The project-level `AGENTS.md` and `README.md` are updated to tell any LLM to read the relevant instructions, start or connect the Laya MCP wrapper, verify connectivity, and route decisions through Laya before entering a deployment workflow.

## What was achieved

The project provides a Node.js MCP stdio wrapper for Laya's HTTP service. The wrapper exposes six read-only tools to Hermes:

| Tool | Purpose |
| --- | --- |
| `decide` | Run multiple typed choice, score, or yes/no decisions in one request. |
| `classify` | Choose one label and return its probability distribution. |
| `score` | Rate input against an ordered scale. |
| `check` | Return `P(yes)` and `P(no)` for a binary question. |
| `judge` | Assess Kubernetes or OpenShift intent, operational risk, and a proceed/review/block verdict. |
| `route_step` | Select the immediate next workflow step for a selected platform. |

The project type-checks, builds, and validates that the compiled MCP server starts and shuts down cleanly through `npm test`.

## How it works with Hermes

Hermes launches the wrapper as an MCP stdio server and discovers its tools at startup. The wrapper forwards structured requests to a local or remote `laya-serve` HTTP endpoint. When configured locally, it can optionally supervise a local Laya service; it does not silently install Python dependencies or model weights.

Hermes acts as the harness around the LLM: it exposes MCP tools, passes bounded deployment state to Laya, records decision events, gathers live evidence, and enforces the deployment workflow's safety gates. The LLM does not need to invent platform routing when Laya can provide a typed, confidence-gated decision.

A recommended control flow is:

1. Read the repository's `AGENTS.md` and `README.md`.
2. Build and configure the MCP wrapper for the active Hermes profile.
3. Confirm connectivity with a harmless `check` call.
4. Record connectivity and every later Laya routing call in append-only `laya-events.jsonl`.
5. Ask Laya to classify one project at a time.
6. Use `judge` and `route_step` to select the next Kubernetes or OpenShift workflow step.
7. Run the corresponding verification-driven deployment workflow.

A completed structured Laya response proves the MCP service path is working. Its yes/no answer is a decision result, not a health signal.

## Kubernetes routing

For Kubernetes, Laya understands routing choices for:

- Read-only inspection of context, resources, events, logs, and manifests.
- Building an image and making it available to the target cluster.
- Applying reviewed Kubernetes manifests or Kustomize output.
- Waiting for rollout completion.
- Verifying workloads, Services, Gateways, and application behavior.
- Diagnosing pods, images, probes, Services, and rollout failures.
- Scaling or rolling back only after the target is confirmed.
- Escalating when context is missing, contradictory, risky, or unsafe.

The intended Kubernetes workflow remains aligned with [[Kubernetes Deployments Skill]]: confirm the target context and namespace, use an immutable image reference, render before apply, load local images into kind when needed, verify Ready Pods and Service endpoints, then test through the selected access path.

## OpenShift routing

For OpenShift or OKD, the router adds platform-specific choices for:

- Inspecting Projects, quotas, permissions, Builds, ImageStreams, Routes, and workloads.
- Building from source or verifying an existing image delivery path.
- Applying reviewed OpenShift resources.
- Waiting for rollout completion and verifying Route behavior.
- Diagnosing failed builds, admissions, quotas, image pulls, pods, and Routes.
- Scaling, rollback, or escalation after the applicable evidence is collected.

OpenShift routing recognizes the operational significance of Projects, SCC-compatible execution, BuildConfigs, ImageStreams, the internal registry, and Routes. The execution workflow remains governed by [[OpenShift Workloads Skill]], including server-side manifest validation and Route-level endpoint testing.

## Decision quality and safety boundaries

Laya is used for routing, not for authorization. A routing result does not grant permission to apply manifests, create Projects, build images, scale workloads, roll back a release, or expose a service.

The router applies confidence gates to `judge` and `route_step` decisions. A low-confidence result should route to evidence gathering or human review rather than an automated change. Explicit artifact evidence also remains authoritative: for example, an `route.openshift.io/v1/Route` resource identifies an OpenShift workload even if a weak classifier response suggests otherwise.

The MCP tools are read-only. They do not execute `kubectl`, `oc`, builds, or mutations. Deployment execution must still confirm target context, namespace, image reference, rendered scope, permissions, rollout health, and live application endpoints.

## Deployment evidence and auditability

Every Laya connectivity, decision, and override event is intended to be appended as one sanitized JSON object per line to `laya-events.jsonl`. The audit record captures the request scope, tool name, structured response, probability or gate information, and the evidence behind any override. Credentials, kubeconfig contents, registry secrets, and unrelated command output must never be logged.

This separation creates a practical division of responsibility:

- **Laya** selects a structured next step.
- **Hermes** invokes the MCP tool, records the outcome, and performs evidence collection.
- **Deployment skills** define the platform-specific verification contract.
- **The operator** authorizes impactful changes and resolves ambiguous or high-risk conditions.

## Project-local interaction memory

The repository's `memory.md` is durable operational memory for the Hermes–Laya integration. It records concise, verified lessons that help future LLM sessions configure Hermes MCP, confirm Laya connectivity, use the tool schemas correctly, interpret confidence, and route Kubernetes or OpenShift work without repeating known integration mistakes.

It is intentionally different from `laya-events.jsonl`. The audit log stores sanitized, append-only connectivity, decision, and override events for individual calls. `memory.md` stores only reusable guidance, such as MCP lifecycle behavior, platform-evidence rules, confidence-handling practices, and the rule that Laya routes workflow decisions but never authorizes cluster mutations.

It must not contain credentials, tokens, kubeconfig data, registry secrets, private URLs, personal information, raw deployment output, per-call request bodies, transient process state, or unverified claims. Entries should remain short, concrete, and evidence-backed; stale guidance should be replaced rather than accumulated.

## Harness portability

Hermes is the current reference harness, not a required property of the routing design. The MCP wrapper speaks the standard stdio MCP protocol and Laya is reached through its HTTP service, so another MCP-capable LLM harness can replace Hermes in a future update. A replacement harness must provide the same operational guarantees: discover the wrapper's tools, call Laya sequentially, retain the audit trail, enforce confidence and evidence gates, and require authorization before state-changing cluster actions.

## Getting started

The project requires Node.js 20+ and Python 3.10+ when using the official local Laya runtime. It also assumes a reachable local Kubernetes installation, a reachable local OpenShift/OKD installation, and Hermes as the current MCP harness. Install the Node dependencies, build the wrapper, run or configure `laya-serve`, then add the compiled wrapper to Hermes MCP configuration. First model use may take longer because Laya can download model weights.

For reusable deployment guidance, see [[Laya MCP Hermes Skill]], [[Kubernetes Deployments Skill]], and [[OpenShift Workloads Skill]].
