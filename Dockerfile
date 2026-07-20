FROM node:24-alpine AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci --registry=${NPM_REGISTRY}

# 迁移与题库批处理镜像：包含 Prisma CLI、tsx 与导入脚本，不进入 Web 运行镜像。
FROM dependencies AS migration
WORKDIR /app
ENV NODE_ENV=production
COPY prisma ./prisma
RUN npx prisma generate
COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY tsconfig.json ./tsconfig.json
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"${APP_AUTO_SEED:-0}\" = \"1\" ]; then npm run db:seed; fi"]

FROM dependencies AS builder
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=512
# 类型检查已在发布前的本地 verify 中完成；云端小内存主机只执行产物编译。
ENV NEXT_SKIP_TYPECHECK=1
COPY . .
RUN npx prisma generate && npm run build

# Web 镜像只保留 Next.js standalone 运行产物，并以非 root 用户运行。
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
