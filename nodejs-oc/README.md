# nodejs-oc

A simple, production-ready Node.js web application configured for OpenShift/Kubernetes deployment.

## Features

- Express.js web framework
- Health check and readiness endpoints
- Non-root user for security
- Graceful shutdown handling
- Multi-stage Docker build for optimized images
- OpenShift Route configuration
- Resource limits and probes configured

## Quick Start (Local Development)

### Prerequisites
- Node.js 24 LTS+
- npm

### Installation

```bash
npm install
npm start
```

Server runs on `http://localhost:3000`

## Building and Deploying on OpenShift

### 1. Build the Docker Image

```bash
# Build with Podman (or Docker)
podman build -t quay.io/<organization>/nodejs-oc:1.0.0 .
```

### 2. Push to Registry

```bash
podman push quay.io/<organization>/nodejs-oc:1.0.0
```

### 3. Deploy on OpenShift/OKD

#### Option A: Using kubectl/oc CLI

```bash
# Login to your cluster
oc login <openshift-url>

# Create a new project
oc new-project nodejs-oc

# Update deployment.yaml with the pushed immutable image reference, then deploy.
oc apply -f deployment.yaml

# Check deployment status
oc get deployments
oc get pods
oc get routes
```

#### Option B: Build from local source in OpenShift

Create a binary build configuration, then upload this directory with
`oc start-build --from-dir=.`. Use a Git URL with `oc new-app` when the source
is hosted in Git; `oc new-app nodejs:24~.` does not upload the current directory.

### 4. Access the Application

Once deployed:

```bash
# Get the route URL
oc get routes

# Open in browser
open http://<route-url>

# Health check
curl http://<route-url>/health

# API info
curl http://<route-url>/api/info
```

## Monitoring

### Check Logs

```bash
# Pod logs
oc logs -f deployment/nodejs-oc

# Previous container logs
oc logs --previous pod/<pod-name>
```

### Check Deployment Status

```bash
oc describe deployment nodejs-oc
oc describe route nodejs-oc
```

### Scale Replicas

```bash
oc scale deployment nodejs-oc --replicas=3
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Main web UI |
| `/health` | GET | Health check (liveness probe) |
| `/ready` | GET | Readiness check |
| `/api/info` | GET | App info and metadata |

## Configuration

Environment variables (set in `deployment.yaml`):

- `NODE_ENV` - Set to `production` in cluster
- `PORT` - Application port (default 3000)
- `HOST` - Bind address (default 0.0.0.0)

## Key OpenShift Features

This deployment includes:

✓ **Security**: Arbitrary non-root UID support and restricted security context  
✓ **Health Checks**: Liveness and readiness probes  
✓ **Resource Management**: CPU and memory requests/limits  
✓ **Load Balancing**: Service and Route configuration  
✓ **Graceful Shutdown**: SIGTERM/SIGINT handlers  
✓ **Multi-stage Build**: Optimized image size  

## Troubleshooting

### Pod won't start
```bash
oc describe pod <pod-name>
oc logs pod/<pod-name>
```

### Image pull errors
```bash
# Check image registry credentials
oc get secrets
oc describe secret <secret-name>
```

### Health check failing
```bash
# Test health endpoint from pod
oc exec -it pod/<pod-name> -- curl localhost:3000/health
```

## File Structure

```
.
├── server.js           # Express.js application
├── package.json        # Node.js dependencies
├── Dockerfile          # Container image definition
├── deployment.yaml     # OpenShift manifests (Deployment, Service, Route)
├── public/
│   └── index.html      # Web UI
└── README.md          # This file
```

## Next Steps

- Integrate with CI/CD pipeline (GitHub Actions, GitLab CI, Jenkins)
- Set up monitoring (Prometheus, Grafana)
- Configure persistent storage if needed
- Add environment-specific configurations
- Implement logging aggregation (ELK, Splunk)
