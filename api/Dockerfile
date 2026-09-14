# ---------- 依赖安装 ----------
FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ---------- 构建 ----------
FROM node:20-bookworm AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---------- 运行 ----------
FROM node:20-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json docker-entrypoint.sh ./
RUN mkdir -p /app/uploads && chown -R app:app /app && chmod +x docker-entrypoint.sh
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
