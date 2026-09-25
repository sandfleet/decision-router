# Step-by-Step Deployment Guide

## Scenario 1: Deploy on Local OpenShift/OKD (CRC, Kind, etc.)

### Step 1: Ensure cluster is running
```bash
# For CRC
crc start

# Check cluster
oc whoami
oc get nodes
```

### Step 2: Create a project
```bash
oc new-project nodejs-oc-demo
```

### Step 3: Build image locally (if using local Docker/Podman)
```bash
# Navigate to app directory
cd /path/to/nodejs-oc

# Build image
podman build -t localhost/nodejs-oc:1.0.0 .

# Or with Docker
docker build -t localhost/nodejs-oc:1.0.0 .
```

### Step 4: Load image into cluster (for local clusters)
```bash
# For Kind
kind load docker-image localhost/nodejs-oc:1.0.0

# For CRC (push to local registry)
podman push localhost/nodejs-oc:1.0.0 --tls-verify=false
```

### Step 5: Update deployment manifest
Edit `deployment.yaml` and change image reference:
```yaml
image: localhost/nodejs-oc:1.0.0
imagePullPolicy: IfNotPresent
```

### Step 6: Deploy application
```bash
oc apply -f deployment.yaml
```

### Step 7: Verify deployment
```bash
# Check deployment status
oc get deployments
oc get pods
oc get routes

# Watch pods starting
oc get pods -w
```

### Step 8: Access application
```bash
# Get the route URL
ROUTE=$(oc get route nodejs-oc -o jsonpath='{.spec.host}')
echo "Open: http://$ROUTE"

# Test endpoints
curl http://$ROUTE/health
curl http://$ROUTE/api/info
```

---

## Scenario 2: Deploy with an OpenShift Binary Build

Use this when the source is only on your workstation. Binary builds upload local
source to OpenShift; they do not retain that source for automatic rebuilds.

### Step 1: Login to cluster
```bash
oc login <cluster-url>
oc new-project nodejs-oc
```

### Step 2: Create and start a binary build
```bash
oc new-build --binary --name=nodejs-oc nodejs:24-ubi9
oc start-build nodejs-oc --from-dir=. --follow
```

This command:
- Uses an OpenShift Node.js 24 builder image
- Archives and uploads the current directory
- Creates and runs a binary BuildConfig

To create an application from a Git repository instead, use:
```bash
oc new-app nodejs:24-ubi9~https://github.com/<organization>/nodejs-oc.git#main --name=nodejs-oc
```

### Step 3: Monitor build
```bash
oc logs -f bc/nodejs-oc
```

### Step 4: Access application
```bash
oc get routes
# Open the route URL in browser
```

---

## Scenario 3: Deploy to Public Registry (Docker Hub, Quay.io)

### Step 1: Create Docker Hub account (if needed)
- Sign up at https://hub.docker.com
- Create repository: `nodejs-oc`

### Step 2: Build and push
```bash
# Login to registry
docker login

# Build image
docker build -t yourusername/nodejs-oc:1.0 .

# Push to registry
docker push yourusername/nodejs-oc:1.0
```

### Step 3: Update deployment manifest
Edit `deployment.yaml`:
```yaml
image: yourusername/nodejs-oc:1.0
imagePullPolicy: IfNotPresent  # Change to Always for remote registry
```

### Step 4: Deploy
```bash
oc login <cluster-url>
oc new-project nodejs-oc
oc apply -f deployment.yaml
```

### Step 5: Monitor and access
```bash
oc get pods -w
oc get routes
```

---

## Scenario 4: CI/CD with Git Push

If your cluster has Git integration:

### Step 1: Clone to Git repository
```bash
git init
git add .
git commit -m "Initial commit"
git push origin main
```

### Step 2: Create app from Git
```bash
oc new-app nodejs:18~https://github.com/yourusername/nodejs-oc.git#main
```

### Step 3: Set webhook (optional, for auto-builds)
```bash
oc describe bc/nodejs-oc | grep webhook
```

---

## Verification Checklist

After deployment, verify everything works:

```bash
# 1. Check deployment
oc get deployment nodejs-oc
# Expected: 2 replicas READY

# 2. Check pods
oc get pods -l app=nodejs-oc
# Expected: 2 Running pods

# 3. Check service
oc get svc nodejs-oc
# Expected: Service with ClusterIP

# 4. Check route
oc get routes
# Expected: Route with accessible hostname

# 5. Test health endpoint
ROUTE=$(oc get route nodejs-oc -o jsonpath='{.spec.host}')
curl https://$ROUTE/health
# Expected: {"status":"healthy","timestamp":"..."}

# 6. Test API endpoint
curl https://$ROUTE/api/info
# Expected: App info JSON

# 7. Check logs
oc logs -f deployment/nodejs-oc
# Expected: "Server running at http://0.0.0.0:3000"
```

---

## Scaling Application

### Scale replicas
```bash
oc scale deployment nodejs-oc --replicas=5
oc get pods -l app=nodejs-oc -w
```

### Monitor resource usage
```bash
oc top pods -l app=nodejs-oc
oc top nodes
```

---

## Rollback Deployment

### View rollout history
```bash
oc rollout history deployment/nodejs-oc
```

### Rollback to previous version
```bash
oc rollout undo deployment/nodejs-oc
```

---

## Update Application

### Update image
```bash
# Build new image
podman build -t yourusername/nodejs-oc:2.0 .
podman push yourusername/nodejs-oc:2.0

# Update deployment
kubectl set image deployment/nodejs-oc \
  nodejs-oc=yourusername/nodejs-oc:2.0

# Monitor rollout
oc rollout status deployment/nodejs-oc
```

---

## Common Issues & Fixes

### Issue: Pod stays in "Pending"
```bash
# Check events
oc describe pod <pod-name>

# Check node resources
oc top nodes
oc describe node <node-name>
```

### Issue: CrashLoopBackOff
```bash
# Check logs
oc logs pod/<pod-name>
oc logs --previous pod/<pod-name>

# Check resource limits
oc describe pod/<pod-name>
```

### Issue: Health check failing
```bash
# Test from inside pod
oc exec -it pod/<pod-name> -- \
  curl -v localhost:3000/health

# Check service DNS
oc exec -it pod/<pod-name> -- \
  nslookup nodejs-oc
```

### Issue: Image not found
```bash
# Verify image exists
podman images | grep nodejs-oc

# Check image pull secrets
oc get secrets
oc get serviceaccount default -o yaml

# Pull manually
oc image pull <image-url>
```

---

## Cleanup

### Delete application
```bash
oc delete -f deployment.yaml
```

### Delete entire project
```bash
oc delete project nodejs-oc-demo
```

---

## Next: Production Readiness

- [ ] Set resource requests/limits appropriately
- [ ] Configure persistent storage if needed
- [ ] Set up monitoring and logging
- [ ] Implement auto-scaling (HPA)
- [ ] Configure network policies
- [ ] Set up backup/restore strategy
- [ ] Document runbooks for common issues
