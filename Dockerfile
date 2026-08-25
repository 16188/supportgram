FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:widget

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
COPY --from=build --chown=node:node /app/public/widget.js ./public/widget.js
RUN mkdir -p data && chown node:node data

USER node
EXPOSE 3000
CMD ["npm", "start"]
