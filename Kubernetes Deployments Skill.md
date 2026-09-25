---
title: Kubernetes Deployments Skill
created: 2026-09-24
updated: 2026-09-25
type: concept
tags: [kubernetes, kind, deployment, containers, tooling, llm]
sources: []
confidence: high
---

# Kubernetes Deployments Skill

A tool-neutral, evidence-based procedure for an LLM or operator to deploy and verify a containerized application on Kubernetes, including kind. Use the available file-reading, editing, command-execution, and HTTP-request tools; replace command examples with equivalent capabilities when necessary.

Do not report a deployment as successful until every applicable item in [[#Verification contract]] is backed by live output. Keep standard Kubernetes resources portable; isolate OpenShift, cloud load balancer, and provider-specific registry configuration in explicitly selected overlays.

## When to use

- Deploying, updating, or verifying a containerized workload on Kubernetes or kind.
- Preparing or reviewing a Dockerfile/Containerfile, manifests, Kustomize tree, or Helm release.
- Diagnosing image pulls, failed Pods, probes, Service endpoints, or stalled rollouts.

Do not apply to a production or shared cluster until the target context, namespace, image reference, rendered scope, and authorization are explicit.

## Required inputs

Gather these facts before modifying cluster state. Read the repository and query the live cluster; do not infer them from the current directory or shell alone.

| Input | Obtain from | Required before apply |
| --- | --- | --- |
| Application contract | Build manifest, entry point, configured port, health endpoints, tests | Yes |
| Deployment artifacts | Dockerfile/Containerfile, manifests, Kustomization, Helm chart, environment files | Yes |
| Target cluster and context | `kubectl config current-context`, `kubectl config get-contexts` | Yes |
| Namespace | Manifest metadata and `kubectl get namespace <name>` | Yes |
| Image reference | Workload image field, registry, tag or digest, pull policy | Yes |
| Container runtime | Available Docker, Podman, or supported builder | Yes |
| Access method | Ingress/Gateway, LoadBalancer, NodePort, or port-forwarding | Yes |

If an input is absent or conflicts with another source, stop before applying and request a decision. Never guess a production context, registry, namespace, or image tag.

## Preflight

```text
kubectl version --client
kubectl config current-context
kubectl get nodes -o wide
kubectl get namespace
kind get clusters                         # when kind is the target
```

Continue only when:

- The active context is explicitly the intended target.
- At least one required node is `Ready`.
- The target namespace exists or is declared in the artifacts.
- Kubernetes CLI and a supported container runtime are available.

For a shared or production-like target, inspect current resources before changes:

```text
kubectl -n <namespace> get deployment,service,ingress
kubectl -n <namespace> get events --sort-by=.lastTimestamp
```

## Deployment procedure

### 1. Inspect the application and artifacts

Read the package/build manifest, lockfile, entry point, Dockerfile/Containerfile, workload resources, Service, Kustomization or chart, and relevant tests. Record the process command, container port, health and readiness paths, resource requirements, namespace, selectors, image reference, and deployment mechanism.

Completion criterion: every artifact that controls runtime behavior or cluster placement is identified.

### 2. Verify the container/runtime contract

Confirm that the application binds to `0.0.0.0`, honors its configured port, logs to stdout/stderr, handles `SIGTERM`, and exposes real health and readiness endpoints. Confirm that container port, Service `targetPort`, and probe port agree. If the manifest specifies non-root execution or a read-only root filesystem, test those conditions before rollout.

Completion criterion: the image starts under declared security restrictions and serves its probe endpoints.

### 3. Select an immutable image strategy

Build an image tagged with a concrete version, commit identifier, or digest. Do not deploy `latest` or reuse a mutable tag when validating changed code.

- For kind, use a local reference such as `localhost/<app>:<version>` with `imagePullPolicy: IfNotPresent`.
- Use the exact same image reference in build, node loading, and workload declaration.
- For remote clusters, push to an accessible registry and prefer a digest when practical.

Completion criterion: every target node can obtain the exact workload image reference.

### 4. Test, build, and smoke-test the exact image

Run the project’s documented tests, then build the precise image declared by the workload. Start it locally with the same port and relevant security restrictions where practical. Request `/health`, `/ready`, and at least one functional endpoint, then stop the test container.

Completion criterion: tests pass, the image build succeeds, and endpoint checks return their expected success responses.

### 5. Make namespace ownership explicit

A Kustomize `namespace:` transformer changes namespaced resources but does not create a Namespace. Include a Namespace resource, deliberately create it, or confirm that it exists. Keep the namespace consistent across resource metadata, commands, and documentation.

Completion criterion: every namespaced resource targets an existing namespace.

### 6. Render and validate before applying

For Kustomize:

```text
kubectl kustomize <kustomize-directory>
kubectl create --dry-run=client --validate=false -k <kustomize-directory>
```

For plain manifests:

```text
kubectl create --dry-run=client --validate=false -f <manifest-or-directory>
```

For Helm, render with the intended release values and inspect generated resources before running the reviewed release command.

Check rendered output for unresolved placeholders, unsupported API groups, mutable images, missing Namespace resources, selector mismatches, invalid probe ports, and unintended objects.

Completion criterion: only intended resources render and client-side validation succeeds.

### 7. Load a local image into kind when applicable

Host images are not automatically visible to kind nodes.

Docker-backed kind:

```text
kind load docker-image <image-reference> --name <cluster-name>
```

Podman-backed kind:

```text
podman save -o <app-image>.tar <image-reference>
kind load image-archive <app-image>.tar --name <cluster-name>
```

Remove the temporary archive after a successful load. For a multi-node cluster, verify every target node can access the image.

Completion criterion: the node runtime contains the exact declared image, or the remote registry path is confirmed accessible.

### 8. Apply only the reviewed scope

Apply using the same mechanism used for rendering:

```text
kubectl apply -k <directory>
kubectl apply -f <path>
```

Use the reviewed Helm release command for Helm-based deployments. Do not broaden scope with a repository-wide apply. Read back the exact Deployment, Service, and associated objects immediately afterward.

Completion criterion: the API server accepts only the intended objects in the intended namespace.

### 9. Verify rollout and diagnose from evidence

```text
kubectl -n <namespace> rollout status deployment/<deployment> --timeout=<bounded-duration>
kubectl -n <namespace> get deployment,pods,service,endpoints
kubectl -n <namespace> describe deployment/<deployment>
kubectl -n <namespace> get events --sort-by=.lastTimestamp
```

If a Pod fails, inspect its `describe` output, current logs, and previous logs before changing configuration.

| Symptom               | Evidence to collect                                | Typical cause                                                                                 |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ImagePullBackOff`    | Pod description and exact image reference          | Image was not loaded into kind, registry is inaccessible, or reference differs from build.    |
| `CrashLoopBackOff`    | Current and previous logs                          | Startup command, configuration, permissions, UID, or filesystem restriction failed.           |
| Probe failures        | Events, endpoint behavior, port/path configuration | Loopback binding, invalid path/port, insufficient startup time, or incorrect readiness logic. |
| No Service endpoints  | Service selector, Pod labels, readiness            | Selectors do not match ready Pods.                                                            |
| Rollout stalls        | Deployment, ReplicaSet, Pod events                 | Resource shortage, probe, image, or configuration failure.                                    |
| TLS or `Unauthorized` | Context, cluster health, clock, credentials        | Kubeconfig, certificate, time, or authorization issue.                                        |

Completion criterion: desired replicas are `Available`; expected Pods are `Running` and `Ready`; Service endpoints exist; recurring warning events are understood or absent.

### 10. Exercise the live service

For a `ClusterIP` Service, start a bounded port-forward:

```text
kubectl -n <namespace> port-forward service/<service> <local-port>:<service-port>
```

Request health, readiness, and a functional endpoint through the Service. For Ingress, Gateway, LoadBalancer, or NodePort, request the published endpoint instead. Stop temporary port-forwards after verification.

Completion criterion: the deployed application returns expected responses through its intended access path.

### 11. Report verified state and limits

Report the exact image reference, Kubernetes context, namespace, apply mechanism, rollout result, endpoint results, and unresolved conditions. Distinguish offline rendering, local smoke tests, and live cluster verification.

Completion criterion: every deployment claim is supported by command or HTTP-request output.

## Quick reference

```text
# Discover and inspect
kubectl config current-context
kubectl get nodes -o wide
kubectl -n <namespace> get deployment,pods,service,endpoints

# Build and validate
<runtime> build -t <image-reference> .
<project-test-command>
kubectl kustomize <directory>
kubectl create --dry-run=client --validate=false -k <directory>

# Load into kind
kind load docker-image <image-reference> --name <cluster>
podman save -o <image>.tar <image-reference>
kind load image-archive <image>.tar --name <cluster>

# Apply and verify
kubectl apply -k <directory>
kubectl -n <namespace> rollout status deployment/<deployment> --timeout=<bounded-duration>
kubectl -n <namespace> logs deployment/<deployment> --all-containers=true
kubectl -n <namespace> port-forward service/<service> <local-port>:<service-port>
```

## Safety boundaries

- Do not run `kubectl apply`, `delete`, `scale`, `rollout undo`, or Helm upgrade commands until the target context, namespace, rendered scope, and image reference are confirmed.
- Do not delete or recreate resources to conceal a rollout failure; inspect descriptions, events, and logs first.
- Do not expose kubeconfig credentials, Secret contents, registry credentials, or tokens in output or reports.
- Do not use `--insecure-skip-tls-verify`, `--force`, or broad cluster-admin access as a deployment fix.
- Do not claim a live deployment from a manifest render, image build, or client-side dry run alone.

## Verification contract

A deployment is complete only when every applicable condition holds:

- [ ] Active context and namespace were explicitly confirmed.
- [ ] Application tests passed.
- [ ] The exact workload image built successfully.
- [ ] Rendered manifests or chart output were inspected and client-side validation passed.
- [ ] Target nodes can obtain the exact image reference.
- [ ] The reviewed apply operation succeeded.
- [ ] The rollout reached the requested replica count.
- [ ] Every expected Pod is `Running` and `Ready`.
- [ ] Service endpoints exist.
- [ ] Health, readiness, and at least one functional endpoint succeeded against the live deployment.
- [ ] Temporary port-forwards and image archives were removed.
- [ ] The report separates verified facts from assumptions and unverified external dependencies.

## Related notes

- [[Nodejs Webapp OpenShift Deployment]] — historical application deployment context.
- [[OpenShift Workloads Skill]] — platform-specific workload workflow.
- [[Helidon OC Project Analysis]] — adjacent deployment analysis.
