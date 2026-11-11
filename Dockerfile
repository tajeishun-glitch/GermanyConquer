FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY shared ./shared
COPY ai-engine ./ai-engine
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "backend/server.mjs"]
