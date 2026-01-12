FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"

CMD ["node", "server.js"]
