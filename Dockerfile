# Multi-stage build for optimal full-stack production hosting
# Base on Node 20 alpine for minimal security footprint and small image size
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for better Docker layer caching
COPY package*.json ./
RUN npm ci

# Copy full source and build assets (Runs vite build & server bundling)
COPY . .
RUN npm run build

# Production runner image
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment flags
ENV NODE_ENV=production

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled frontend and backend assets from the build stage
COPY --from=builder /app/dist ./dist

# Expose server entry port
EXPOSE 3000

# Run the bundled full-stack production server
CMD ["node", "dist/server.cjs"]
