# Hermes–Laya Interaction Memory

Use this file to retain durable interaction nuances between Hermes and the Laya MCP wrapper. It is project-local operational memory, not a replacement for `laya-events.jsonl`.

## Purpose

- Record reusable observations about Hermes MCP discovery, Laya connectivity, tool schemas, decision quality, and routing behavior.
- Preserve lessons that change how an LLM should use Laya in this repository.
- Help future LLM sessions avoid repeating known integration mistakes.

## Do not record

- Passwords, API keys, access tokens, kubeconfig contents, registry credentials, private URLs, or personal data.
- Raw deployment command output, full request bodies, or per-call decision records. Those belong in the append-only `laya-events.jsonl` audit log.
- Temporary status, transient process IDs, or claims that have not been verified.

## Recording rules

1. Read this file before configuring Hermes MCP, diagnosing Laya, or routing a Kubernetes/OpenShift deployment decision.
2. Add an entry only when it captures a durable, verified nuance that will help future sessions.
3. Use concrete evidence: tool name, configuration behavior, schema requirement, or verified platform result.
4. Keep entries concise. Replace stale or superseded guidance rather than accumulating contradictions.
5. A Laya result routes workflow decisions; it never authorizes cluster mutations. Preserve this distinction in every entry.

## Known interaction nuances

### Hermes MCP lifecycle

- Hermes discovers configured stdio MCP servers at startup and exposes their tools with the `mcp__<server>__<tool>` naming pattern.
- After a wrapper configuration change, restart or reload the active Hermes profile before expecting new Laya tools to appear.
- A completed structured Laya tool response proves MCP transport connectivity. The semantic yes/no output from `check` is a model decision, not a health verdict.

### Laya tool usage

- Call local Laya MCP tools sequentially. Each local invocation is a separate tool call.
- Use one separately scoped Laya decision per project. Combining unrelated projects in one classification request produces an ambiguous single result.
- Use `classify` for a label, `decide` with typed `choice` criteria for an auditable comparison, `judge` for Kubernetes/OpenShift intent-risk-verdict routing, and `route_step` for the immediate platform workflow step.
- Treat low-confidence or near-tie classifications as advisory. Resolve them using explicit manifests and API resources, then record the override in `laya-events.jsonl`.

### Platform evidence

- Standard Kubernetes APIs with a kind-local image workflow indicate Kubernetes/kind.
- OpenShift-only resources, including `route.openshift.io/v1/Route`, ImageStreams, BuildConfigs, an OpenShift internal registry reference, or Route verification, indicate OpenShift/OKD.
- Explicit artifact evidence overrides a weak or conflicting platform classifier result.

### Audit boundary

- Record every connectivity, decision, and evidence-override event in the project-root `laya-events.jsonl` as sanitized, append-only JSON Lines.
- Use this file only for durable operational lessons, not event-by-event audit records.
