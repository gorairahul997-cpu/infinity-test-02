FROM node:20-slim

# Install system dependencies for Puppeteer, Chromium, and native compilation of SQLite3
RUN apt-get update && apt-get install -y \
    chromium \
    build-essential \
    python3 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Tell Puppeteer to use the system Chromium instead of downloading a custom one
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy package files
COPY package*.json ./

# Install project dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
