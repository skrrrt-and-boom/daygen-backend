# syntax=docker/dockerfile:1

FROM --platform=linux/amd64 node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS builder
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/assets ./assets


# Install Python and dependencies
RUN apk add --no-cache python3 py3-pip ffmpeg py3-numpy ttf-dejavu ttf-liberation font-noto fontconfig
# Install only essential python packages for stitching (avoiding heavy librosa build)
RUN pip3 install ffmpeg-python --break-system-packages
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
