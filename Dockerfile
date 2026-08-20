FROM node:20-alpine AS builder

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY prisma/ ./prisma/
COPY public/ ./public/

# Generate Prisma client and compile TypeScript
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install prisma@5.22.0

# Copy built output and assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY start.js ./

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Run migrations then start the server
CMD ["node", "start.js"]
