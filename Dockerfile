# Тот же запуск, что на проде (scripts/deploy-regru.sh): фронт в dist/, сервер — один файл esbuild без node_modules.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 CACHE_DIR=/data/cache
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server/server.mjs ./
# кэш ответов, своих дел, комнат и голоса переживает пересоздание контейнера
RUN mkdir -p /data/cache && chown -R node:node /data
VOLUME /data
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
