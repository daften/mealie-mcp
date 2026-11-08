# Stage 1: build
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: skip the `prepare` git-hook script; there is no .git directory in the image.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Stage 2: runtime
FROM node:24-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
# Owned by the unprivileged user so a fresh named volume inherits it. Only login mode writes here.
RUN mkdir /data && chown node:node /data
ENV MCP_DATA_DIR=/data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/index.js", "--transport", "http", "--host", "0.0.0.0"]
