# Pinned Node.js 24 LTS image for reproducible builds.
FROM node:24-alpine@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a AS builder

WORKDIR /opt/app-root/src

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /opt/app-root/src

COPY --from=builder --chown=1001:0 /opt/app-root/src/node_modules ./node_modules
COPY --chown=1001:0 package.json ./
COPY --chown=1001:0 server.js ./
COPY --chown=1001:0 public ./public

# Permit arbitrary non-root UIDs through group 0.
RUN chgrp -R 0 /opt/app-root && chmod -R g=u /opt/app-root

USER 1001

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http=require('http');const req=http.get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/health'},res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(5000,()=>{req.destroy();process.exit(1)})"

CMD ["node", "server.js"]
