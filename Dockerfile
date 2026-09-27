# Сборка фронта
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Рантайм: один процесс отдаёт dist/ и /api (сервер запускается через tsx)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 CACHE_DIR=/data/cache
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
RUN mkdir -p /data/cache && chown -R node:node /data
USER node
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/server/prod.ts"]
