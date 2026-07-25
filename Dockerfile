FROM node:22-alpine

WORKDIR /app

# Enable corepack and use pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files and prisma schema
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Generate Prisma Client
RUN pnpm run prisma:generate

# Build the TypeScript backend
RUN pnpm run build

# Start the application
CMD ["pnpm", "start"]
