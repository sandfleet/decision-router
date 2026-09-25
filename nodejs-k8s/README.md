# nodejs-k8s

A small Express application packaged for Kubernetes and kind.

## Features

- Express.js web server
- Kubernetes liveness and readiness endpoints
- Non-root container with dropped capabilities
- Read-only root filesystem support
- Graceful SIGTERM shutdown
- Multi-stage container build
- Kubernetes Deployment, Service, and Kustomize configuration

## Local development

Prerequisites: Node.js 24 LTS or newer and npm.

```bash
npm install
npm start
```

The server listens on `http://localhost:3000`.

## Build the image

```bash
podman build -t localhost/nodejs-k8s:1.0.1 .
# Docker can be used instead:
# docker build -t localhost/nodejs-k8s:1.0.1 .
```

## Deploy to kind

Create a cluster if needed:

```bash
kind create cluster --name nodejs-k8s
```

Load the local image into kind. With Docker:

```bash
kind load docker-image localhost/nodejs-k8s:1.0.1 --name nodejs-k8s
```

With Podman:

```bash
podman save -o nodejs-k8s.tar localhost/nodejs-k8s:1.0.1
kind load image-archive nodejs-k8s.tar --name nodejs-k8s
rm nodejs-k8s.tar
```

Apply the Kubernetes resources:

```bash
kubectl apply -k .
kubectl -n nodejs-k8s rollout status deployment/nodejs-k8s
kubectl -n nodejs-k8s get pods,svc
```

The image uses `IfNotPresent`, so kind will use the locally loaded image instead of pulling it.

Access the application through a local port-forward:

```bash
kubectl -n nodejs-k8s port-forward service/nodejs-k8s 3000:80
```

Then open `http://localhost:3000` or test the endpoints:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl http://localhost:3000/api/info
```

## Deploy to another Kubernetes cluster

Build and push the image to a registry, then update the `image` field in `deployment.yaml` to the registry reference. For production, prefer an immutable digest and use an image-pull secret when the registry is private.

```bash
kubectl apply -k .
kubectl -n nodejs-k8s rollout status deployment/nodejs-k8s
```

The manifest intentionally uses a `ClusterIP` Service. Choose an Ingress, Gateway API resource, `LoadBalancer`, or port-forward according to the cluster environment.

## API endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Web UI |
| `/health` | GET | Liveness probe |
| `/ready` | GET | Readiness probe |
| `/api/info` | GET | Application and pod metadata |

## Configuration

- `NODE_ENV`: set to `production` by the Deployment
- `PORT`: set to `3000` by the Deployment
- `HOST`: defaults to `0.0.0.0` in the application and image

## Files

- `server.js`: Express application
- `Dockerfile`: multi-stage runtime image
- `deployment.yaml`: Kubernetes Deployment and Service
- `namespace.yaml`: application namespace
- `kustomization.yaml`: Kubernetes Kustomize entry point
