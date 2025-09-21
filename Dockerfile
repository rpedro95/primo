FROM node:18-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++ sqlite

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with better-sqlite3 rebuild
RUN npm ci --only=production
RUN npm rebuild better-sqlite3

# Copy source code
COPY . .

# Create data directory with proper permissions
RUN mkdir -p data && chmod 755 data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
