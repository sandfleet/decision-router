# Local Cluster Discovery Instructions

Use these instructions before choosing a local deployment target. Discovery is read-only: do not install, start, stop, delete, apply, or otherwise change cluster state unless the user explicitly asks.

## 1. Discover a local OpenShift or OKD installation

1. Check independently for the relevant clients and local runtime:

   ```bash
   command -v crc || true
   command -v oc || true
   crc status
   ```

2. If CRC is installed and reports `OKD: Running`, use CRC's client and kubeconfig explicitly for every OpenShift command. `crc oc-env` adds the CRC-provided `oc` binary to `PATH`; it does not select the CRC cluster by itself.

   ```bash
   export PATH="/home/abhishek/.crc/bin/oc:$PATH"
   export KUBECONFIG=/home/abhishek/.crc/machines/crc/kubeconfig
   oc whoami
   oc project
   oc get nodes -o wide
   oc projects
   ```

3. Treat an OpenShift target as usable only when all of the following succeed:
   - `crc status` shows `OKD: Running`, or another explicitly selected OpenShift/OKD cluster is reachable.
   - `oc whoami` returns an identity.
   - `oc get nodes` shows at least one `Ready` node.
   - The intended project is selected or exists and permissions are verified with `oc auth can-i`.

4. Do not use generic `kubectl` output as proof that the OpenShift client is targeting CRC. Verify the API server and active project with the explicit CRC `KUBECONFIG` above.

5. Do not print kubeconfig contents, credentials, tokens, or registry secrets. Do not run `crc start`, `oc login`, `oc new-project`, `oc apply`, `oc delete`, or builds during discovery.

## 2. Discover a local Kubernetes installation

1. Check independently for standard Kubernetes clients, local providers, and container runtimes:

   ```bash
   command -v kubectl || true
   command -v kind || true
   command -v minikube || true
   command -v k3d || true
   command -v docker || true
   command -v podman || true
   ```

2. Inspect the active Kubernetes context and cluster health without changing it:

   ```bash
   kubectl config current-context
   kubectl config get-contexts
   kubectl get nodes -o wide
   kind get clusters
   minikube status --all 2>/dev/null || true
   k3d cluster list 2>/dev/null || true
   ```

3. Treat a Kubernetes target as usable only when an explicitly selected context has at least one `Ready` node. For kind, confirm the intended cluster name with `kind get clusters` and verify that the active `kubectl` context matches it.

4. For a proposed deployment, separately check the target namespace and existing resources before applying anything:

   ```bash
   kubectl get namespace <namespace>
   kubectl -n <namespace> get deployment,service,pods,endpoints
   ```

5. Do not create clusters, switch contexts, apply manifests, load images, scale workloads, or delete resources during discovery. Do not inspect or print kubeconfig secrets.

## Laya MCP decision control

Before performing a platform-selection or deployment action, an LLM must read this entire `AGENTS.md` file and follow this sequence.

1. **Initialize Laya through Hermes.** Hermes starts configured stdio MCP servers during agent startup and registers their tools as `mcp_<server>_<tool>`. Confirm that the configured Laya server is available through Hermes before making a decision. If Hermes is not running with a configured Laya MCP server, restart Hermes after an authorized MCP configuration change; do not invent a Laya server command or hand-edit Hermes configuration.
2. **Verify connectivity.** Call a harmless Laya tool, such as `mcp__laya__check`, with a small explicit `state` and `question`. A completed structured response proves transport connectivity; do not interpret its yes/no classification as a health verdict.
3. **Log the connectivity call.** Append one JSON object to `laya-events.jsonl` in this directory before relying on the result. Include UTC timestamp, event type, tool name, sanitized input, raw structured output, and whether the call completed. Never log credentials, kubeconfig contents, tokens, or unrelated tool output.
4. **Ask Laya for one decision per project.** Do not send multiple projects in a single classification request. Use `mcp__laya__classify` or a typed `choice` decision with mutually exclusive labels and explicit selection criteria. Include only decisive artifact facts: API groups/kinds, image-delivery path, target-specific registry references, and access resources such as Routes.
5. **Log every decision call and result.** Immediately append the tool name, sanitized request, raw response, selected label, probability distribution, confidence fields, and decision scope to `laya-events.jsonl`. Keep one JSON object per line so the file is append-only and machine-readable.
6. **Apply a confidence gate.** Treat low-margin or low-confidence responses as advisory. Resolve them from explicit manifest/API evidence and log that override, including the evidence and reason. An OpenShift-only resource such as `route.openshift.io/v1/Route` overrides a weak or conflicting Kubernetes classification.
7. **Only then continue with the applicable Kubernetes or OpenShift workflow in this file.** Do not make deployment changes solely because a Laya call returned a label. The applicable workflow's preflight, image, render, authorization, rollout, and endpoint-verification requirements remain mandatory.

`laya-events.jsonl` is an audit log, not an Obsidian note. Create it only when the first Laya call is made. Preserve prior lines; append rather than rewrite. Use a concrete absolute project path when writing to it:

```text
/home/abhishek/Downloads/decision-router/laya-events.jsonl
```

## Platform selection rule

- Use Kubernetes/kind when rendered artifacts use only standard Kubernetes APIs and the declared image workflow is local to kind or another selected Kubernetes cluster.
- Use OpenShift/OKD when artifacts include OpenShift APIs (for example `route.openshift.io/v1`), ImageStreams, BuildConfigs, the OpenShift internal registry, or a Route-based verification path.
- If an LLM classifier conflicts with explicit API/resource evidence, use the manifest evidence and report the model's confidence as advisory only.
