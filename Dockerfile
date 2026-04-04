FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production

# Default: seed + 15x hizda baslat
CMD ["npx", "tsx", "src/main.ts", "--reset", "--start", "06:00", "--speed", "15"]
