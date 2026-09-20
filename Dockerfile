FROM node:22-alpine AS admin-build
WORKDIR /app/admin
COPY admin/package*.json ./
RUN npm ci
COPY admin ./
RUN npm run build
RUN mkdir -p /app/admin-dist && cp -r dist /app/admin-dist && mv /app/admin-dist/dist/* /app/admin-dist && rmdir /app/admin-dist/dist 2>/dev/null || true

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations
COPY --from=admin-build /app/admin-dist ./admin-dist
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]