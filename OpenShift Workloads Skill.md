---
name: openshift-workloads
description: Deploy and verify workloads on OpenShift or OKD.
version: 1.1.0
license: MIT
platforms: [linux, macos, windows]
tags: [OpenShift, OKD, Kubernetes, deployment, CRC]
---
	
# OpenShift Workloads

Use this skill to deploy a containerized application, local source tree, or registry image to OpenShift or OKD. Follow the complete workflow: inspect the application, verify cluster access, build or select a reproducible image, validate manifests, roll out the workload, and test the application through its Route.

This skill is provider-neutral. The executing LLM must map the generic capabilities below to its own tools for reading files, editing files, running shell commands, asking for approval, and inspecting command output.

Do not administer cluster-wide policy with this skill. Keep changes namespace-scoped unless the user explicitly authorizes broader changes.

## When to use

Use this skill when asked to:

- Deploy local application source to OpenShift or OKD.
- Deploy an existing container image.
- Review or improve an OpenShift Deployment, Service, Route, probes, or image-delivery path.
- Verify a workload running on CRC or another OpenShift cluster.

Do not use it to guess credentials, bypass authentication, expose secrets, or perform destructive cluster-wide administration.

## Required capabilities

The executing LLM needs equivalent capabilities for:

- Reading and searching files.
- Writing or patching manifests.
- Running shell commands and capturing exit status and output.
- Inspecting structured command output such as JSON or YAML.
- Asking the user for approval before destructive or externally visible changes.

If a capability is unavailable, stop and report the blocker rather than claiming completion.

## Environment discovery and alternatives

Do not assume that CRC, `oc`, `kubectl`, Docker, Podman, a local registry, or the agent's current working directory exists.

1. Resolve the project directory explicitly. Prefer a user-provided absolute path, then a repository/workspace path supplied by the host agent, then a checked-out Git directory. Inspect it before running build commands. If the source path is unknown, ask the user; never silently use the agent's current directory.
2. Check for `oc`, `kubectl`, `crc`, Docker, and Podman independently. A missing CRC installation is not a deployment blocker if a reachable OpenShift API and `oc` are available.
3. If `oc` is missing, use an approved installation or execution path available in the environment, or report the missing client. Do not install software or modify PATH without approval.
4. Detect the cluster connection from the active kubeconfig/context, an explicitly supplied API server, or a platform-specific login flow. Prefer the existing authenticated context; never print kubeconfig contents or tokens.
5. Classify the target as local CRC, remote OpenShift/OKD, hosted OpenShift, or unknown. Use CRC-only commands only after confirming CRC is installed and running.
6. For a remote cluster, verify DNS/network reachability, TLS, current context, identity, namespace, and permissions. Do not use `crc oc-env` for remote clusters.

Completion criterion: the source path, available clients, target type, API endpoint/context, identity, namespace, and permissions are known. Every unavailable local component has a documented alternative or blocker.

## Source-location alternatives

The agent's working directory is not necessarily the application directory. Before any build:

- Resolve and record an absolute source path.
- Verify the expected files exist there (`package.json`, lockfile, Dockerfile, manifests, or repository metadata).
- Run all source-relative commands with an explicit working directory.
- For Git source, use the remote repository and revision only when the user authorizes fetching it.
- For a source archive or uploaded workspace, unpack it into a known temporary/workspace directory and verify its contents.
- For a remote build service, pass the repository URL and exact revision rather than relying on local files.

Completion criterion: the build context is explicitly selected and independently verified, not inferred from the agent's process directory.

## JavaScript and TypeScript application guidance

Support common JavaScript frameworks and package managers, including Node.js services, Express, Fastify, NestJS, Next.js, Nuxt, React, Angular, Vue, Svelte, Vite, Remix, and similar frameworks. Detect the project rather than assuming one framework:

- Read `package.json`, lockfiles, workspace files, and build scripts.
- Match the Node.js version from `engines`, `.nvmrc`, `.node-version`, Volta, toolchain files, or documented project requirements.
- Select the package manager from the lockfile: `npm` for `package-lock.json`, Yarn for `yarn.lock`, pnpm for `pnpm-lock.yaml`, and Bun only when the project explicitly requires it.
- Use a frozen/locked install in CI or image builds (`npm ci`, `yarn install --immutable` or the project-equivalent), and run the declared test, lint, and build scripts.
- Detect the runtime command and port from `scripts`, framework configuration, Dockerfile, and environment documentation. Do not assume port 3000 or 8080.
- For frontend-only frameworks, build static assets and serve them with the project's intended web server, or use the existing supported hosting image. For SSR frameworks such as Next.js or Nuxt, use the framework's production server and required output mode.
- Ensure the server binds to `0.0.0.0`, not only `localhost`, when running in a container.
- Do not bake secrets into JavaScript bundles, Docker layers, or image build arguments. Separate public build-time variables from runtime secrets.
- Configure health and readiness endpoints appropriate to the framework. If no endpoint exists, use a verified lightweight HTTP path and document that limitation.

Completion criterion: the package manager, Node version, build command, production start command, listening port, health paths, and framework deployment mode are read from the project and tested.

## Preconditions

Before changing resources, establish:

- Source directory and application purpose.
- Dockerfile or existing image reference.
- Existing Kubernetes/OpenShift manifests.
- Intended namespace and application name.
- Application port and health endpoints.
- Whether the source is local, Git-based, or already published to a registry.
- Whether the current cluster is CRC, OKD, or another OpenShift environment.
- Whether the image will be built locally, by OpenShift, by CI, or by a remote registry service.
- Whether the target registry is the OpenShift internal registry, a cloud registry, or another remote registry.

Never infer a deployable image from a Dockerfile alone. Build it or read back the exact image tag and digest from the target registry or ImageStream.

## Safety rules

- Inspect existing namespaces, BuildConfigs, Deployments, Services, Routes, ImageStreams, and ImageStreamTags before modifying them.
- Do not print, store, or request passwords, tokens, registry credentials, private keys, webhook secrets, or kubeconfig contents.
- Do not create a namespace if it already exists; inspect and select it instead.
- Do not delete or replace existing resources unless the user explicitly approves that scope.
- Do not deploy `latest`, an empty image, a placeholder image, or an unverified mutable tag.
- Do not apply a base manifest containing a placeholder image.
- Do not report success from an `apply` command alone.
- If a rollout fails, stop changing resources, inspect the failure, and report the observed blocker.
- Preserve the user's identifiers, paths, image tags, and values exactly unless a deliberate change is documented.

## Procedure

### 1. Inspect and test the application

Read the source tree, Dockerfile, build files, and manifests. Identify the configured compiler or runtime version and match the builder image to it. For example, a project configured for Java release 27 requires a JDK that supports release 27.

Run the project's available tests and local validation. If tests or a local image build fail, report the actual failure and do not continue as if the artifact were deployable.

Completion criterion: the source, build requirements, application port, endpoints, and deployment inputs are known; available tests and builds pass or their blocker is recorded.

### 2. Establish cluster readiness

First check whether `oc` is available and whether an authenticated context already exists. Use the equivalent of:

```bash
oc version --client
oc whoami
oc status
oc project
oc auth can-i create deployments
oc auth can-i create services
```

For CRC only, after confirming that `crc` exists and reports a running instance, expose its client environment in the same shell as every CRC `oc` command:

```bash
crc status
eval $(crc oc-env)
oc whoami
```

If CRC is absent, stopped, unsupported, or unsuitable, use one of these alternatives:

- An existing remote OpenShift or OKD kubeconfig context.
- An explicit remote API server and an approved `oc login` flow.
- A hosted OpenShift provider's documented login or project context.
- A CI runner or bastion that already has `oc` and network access.
- A containerized or otherwise approved OpenShift client, if the execution environment permits it.

Do not install CRC merely because it is missing. Do not use `crc oc-env` for a remote cluster. For remote targets, verify API reachability, TLS, context, identity, namespace, and permissions before changing resources. Create a namespace only after checking that it does not already exist and only when the user has authorized creation.

Completion criterion: the selected cluster connection, identity, namespace, and permissions are read back successfully, with the local or remote execution path recorded.

### 3. Check build capacity

Perform this check only when the build will run inside the OpenShift cluster. For local, CI, cloud, or remote builders, inspect that builder's capacity and logs instead.

Before an in-cluster build, inspect node conditions and ephemeral storage:

```bash
oc get nodes
oc describe node <node>
oc get node <node> -o jsonpath='{.status.capacity.ephemeral-storage}{" "}{.status.conditions[?(@.type=="DiskPressure")].status}{"\\n"}'
```

Do not start a large build while the selected node is under disk pressure. For CRC, increase its configured disk capacity and restart it only with user approval, then verify `DiskPressure=False`.

Completion criterion: the selected builder has sufficient capacity and no active disk pressure, or the external builder's capacity and successful completion are verified.

### 4. Select and validate image delivery

Choose one delivery path based on where the source and registry are available:

- Existing image: use a signed, immutable version tag or digest from a trusted registry.
- OpenShift internal registry: build in OpenShift and use the ImageStreamTag or digest, when the target cluster exposes and permits its internal registry.
- Local non-Git source with a Dockerfile: use an OpenShift binary Docker build when the client can upload the source to the target cluster.
- Git source: use a repository-based OpenShift build or a CI build, pinned to an exact revision.
- Cloud or remote registry: build with an approved local, CI, cloud build, or remote builder, push to the registry, and deploy the immutable digest.
- No local container engine or registry: use OpenShift's binary/source build, a CI runner, or a cloud build service. Do not assume Docker, Podman, or a local registry exists.

For a local binary Docker build, the equivalent commands are:

```bash
oc new-build --binary --strategy=docker --name=<app> --to=<app>:<version>
oc start-build <app> --from-dir=<source-directory> --follow
```

Use a non-placeholder version such as `1.0.0`; never use `latest`. Validate every external `FROM` image before building. Fully qualify Docker Hub images as `docker.io/library/<name>:<tag>` when the cluster's unqualified search order could select a protected or unintended registry.

Read back the Build phase and the resulting ImageStreamTag or remote registry digest:

```bash
oc get build
oc get buildconfig <app> -o yaml
oc get istag <app>:<version> -o yaml
```

For a cloud or remote registry, verify the image exists using that registry's approved CLI or API, inspect its digest and platform manifest, and confirm the target cluster can pull it. Configure an image pull secret in the target namespace only through the platform's secure secret mechanism; never place registry credentials in this file, manifests, command output, or image arguments. A registry tag is not sufficient unless its digest is read back and pinned for deployment.

Completion criterion: the exact immutable image reference exists in the selected registry or ImageStream, the target cluster can pull it, and the build completed successfully.

### 5. Prepare the deployment

Render a target-specific image patch or overlay. Keep the base manifest generic. Discover an OpenShift internal registry dynamically when needed:

```bash
oc registry info --internal
```

The Deployment must reference the exact built image, preferably by digest. It must not contain `latest`, an empty value, or a placeholder. Include, as appropriate:

- Container port.
- Readiness and liveness probes.
- Resource requests and limits.
- A Service selecting the Deployment labels.
- An OpenShift Route targeting the Service.
- A security context compatible with OpenShift's arbitrary UID model.

Completion criterion: the rendered Deployment contains the exact immutable image and the Service, probes, and Route are internally consistent.

### 6. Render and validate the exact deployment

Render the same source that will be applied:

```bash
kubectl kustomize <overlay-or-root>
```

Then validate against the connected API server:

```bash
oc apply --dry-run=server -k <overlay-or-root>
```

Use `-f` only for an unrendered manifest. Validate OpenShift Route resources against a connected OpenShift API; generic Kubernetes client validation may not recognize them.

Completion criterion: rendering succeeds and server-side validation succeeds without applying changes.

### 7. Apply and wait for rollout

Apply the validated source:

```bash
oc apply -k <overlay-or-root>
oc rollout status deployment/<name> --timeout=180s
oc get deployment <name> -o wide
oc get pods -l app=<name> -o wide
```

Every desired replica must be Ready and Available. If rollout fails, inspect without making speculative changes:

```bash
oc describe deployment/<name>
oc describe pod -l app=<name>
oc get events --sort-by=.lastTimestamp
oc logs deployment/<name>
```

Completion criterion: rollout completes within the timeout and the desired, ready, and available replica counts match.

### 8. Verify through the Route

Read the Route host from the API rather than guessing it:

```bash
ROUTE=$(oc get route <name> -o jsonpath='{.spec.host}')
printf 'https://%s\n' "$ROUTE"
```

Test the expected liveness, readiness, and application endpoints through the Route. For a local CRC development certificate only, use `curl -k`; otherwise validate TLS normally:

```bash
curl -fsS -w '\nHTTP %{http_code}\n' "https://${ROUTE}<health-path>"
curl -fsS -w '\nHTTP %{http_code}\n' "https://${ROUTE}<readiness-path>"
curl -fsS -w '\nHTTP %{http_code}\n' "https://${ROUTE}<application-path>"
```

Test as a Route client, not only through a Pod or Service. Confirm the response body and HTTP status match the application's expected behavior.

Completion criterion: Route DNS, TLS behavior, health, readiness, and representative application endpoints all pass.

### 9. Verify shutdown behavior

If the user requested shutdown testing, scale down or stop the workload only with approval. Confirm termination completes cleanly, no unexpected restart occurs, and the resource state is restored if restoration was part of the request.

Completion criterion: shutdown behavior is observed and the final resource state is explicitly read back.

## Troubleshooting

- Build fails with an unsupported compiler release: match the builder JDK or runtime to the project's configured release.
- Build pod is evicted: inspect node `DiskPressure` and ephemeral storage before retrying.
- Image cannot be pulled: validate the fully qualified `FROM` image and registry access.
- Route is rejected during validation: use server-side validation against the OpenShift API.
- Pods are not Ready: inspect pod events, logs, probes, image pull status, and resource limits.
- Rollout succeeds but the endpoint fails: test the Route, Service selector, target port, TLS termination, and application path.
- A local directory is not accepted as a Git source: create a Binary BuildConfig and use `oc start-build --from-dir`.

## Final report

Report only values read back from the cluster and command output:

- Namespace.
- Deployment name.
- Immutable image tag and digest.
- Build result.
- Desired and Ready replica counts.
- Route URL.
- Health, readiness, and application endpoint results.
- Any CRC certificate caveat.
- Any unresolved blocker or skipped verification.

A deployment is complete only when the image exists, the rollout is Ready, probes pass, and the expected endpoints succeed through the Route.

## Portability notes

This file intentionally does not require Hermes Agent. An LLM importing it should translate the generic actions into its own tool names and preserve the completion criteria. Shell examples assume an authenticated OpenShift client with permission to inspect and modify only the intended namespace.
