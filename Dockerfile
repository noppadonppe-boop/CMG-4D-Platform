FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY docs ./docs

USER node
EXPOSE 8080
CMD ["npm", "start"]
