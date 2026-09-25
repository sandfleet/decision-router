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
   eval "$(crc oc-env)"
   export KUBECONFIG="$HOME/.crc/machines/crc/kubeconfig"
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

Before making a platform-selection or deployment-routing decision, an LLM must read this entire `AGENTS.md` and then read the repository `README.md`. `README.md` is the source of truth for this wrapper's current package prerequisites, build command, configuration variables, supported Laya service modes, and Hermes MCP configuration.

1. **Prepare the downloaded repository.** Work from the repository root. Follow the current `README.md` to install Node dependencies and build the wrapper. Do not infer the Node version, Python command, `laya-serve` command, API URL, or environment variables from another machine.
2. **Start or select the Laya service.** Follow `README.md` exactly: use an already-running Laya HTTP service, or explicitly opt into the wrapper's documented local autostart mode after its Python/Laya prerequisites are present. Do not silently install Python packages, download model weights, or create credentials. Do not hand-edit Hermes configuration.
3. **Register and start the wrapper through Hermes.** Configure the repository's compiled MCP stdio wrapper using the Hermes MCP workflow documented in `README.md` and the installed Hermes CLI. Hermes starts configured stdio MCP servers at startup and registers their tools as `mcp_<server>_<tool>`. If configuration changes are needed, use the Hermes CLI for the active profile and restart/reload Hermes as its current CLI requires.
4. **Verify connectivity before routing.** Hermes must call a harmless Laya tool, such as `mcp__laya__check`, with a short explicit `state` and `question`. A completed structured tool response proves that the MCP wrapper and its Laya service path are working. The yes/no prediction itself is not a health result.
5. **Report readiness to the user.** State whether Laya is ready, identify the verified wrapper/tool path, and report any concrete blocker and the next command or prerequisite from `README.md`. Do not claim readiness from configuration alone.
6. **Log the connectivity call.** Append one JSON object to `laya-events.jsonl` in this directory before relying on the result. Include UTC timestamp, event type, tool name, sanitized input, raw structured output, and whether the call completed. Never log credentials, kubeconfig contents, tokens, or unrelated tool output.
7. **Route every decision through Laya.** Laya is the exclusive selector of platform and next workflow step. Make one sequential, separately scoped Laya call per project; never classify multiple projects in one request. Use `mcp__laya__classify` or typed `choice` for platform selection, then `mcp__laya__judge` and `mcp__laya__route_step` for Kubernetes/OpenShift workflow routing when available. Supply only decisive artifact facts: API groups/kinds, image-delivery path, target-specific registry references, access resources such as Routes, and verified cluster state.
8. **Log every routing call and result.** Immediately append the tool name, sanitized request, raw response, selected label or step, probability distribution, confidence fields, gate result, and decision scope to `laya-events.jsonl`. Keep one JSON object per line so the file is append-only and machine-readable.
9. **Enforce evidence and safety gates.** A Laya decision routes the workflow; it does not authorize an external action. If the Laya confidence gate fails, stop routing and gather the missing evidence or request user review. Explicit API/resource evidence resolves an ambiguous platform result and must be recorded as an override. Normal target-context, namespace, image, authorization, render, rollout, endpoint, and user-approval requirements remain mandatory before a state-changing command.

`laya-events.jsonl` is an audit log, not an Obsidian note. Create it only when the first Laya call is made. Preserve prior lines; append rather than rewrite. Use the resolved absolute project path when writing to it:

```text
$(pwd)/laya-events.jsonl
```

## Platform selection rule

- Use Kubernetes/kind when rendered artifacts use only standard Kubernetes APIs and the declared image workflow is local to kind or another selected Kubernetes cluster.
- Use OpenShift/OKD when artifacts include OpenShift APIs (for example `route.openshift.io/v1`), ImageStreams, BuildConfigs, the OpenShift internal registry, or a Route-based verification path.
- If an LLM classifier conflicts with explicit API/resource evidence, use the manifest evidence and report the model's confidence as advisory only.
