# ---- Base Node ----
# Use a specific slim version for smaller size
FROM node:18-slim as build-stage

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .
# Build the application
RUN npm run build

# ---- Production ----
# Use the same slim base image
FROM node:18-slim as production
WORKDIR /app
ENV NODE_ENV=production
# Copy required artifacts from previous stages
COPY --from=build-stage /app/package*.json ./
RUN npm install --production


COPY --from=build-stage /app/dist ./

# Expose the application port
EXPOSE 3000

# Command to run the application
# Assumes your entry point is dist/main.js
CMD ["node", "main.js"]