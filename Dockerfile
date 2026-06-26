# Stage 1: Build React Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build and Run Backend
FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --only=production
COPY backend/ ./

# Copy the compiled React frontend from Stage 1 into the backend's static directory
COPY --from=frontend-builder /app/frontend/dist ./public/dist

# Expose Express port
EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production

# Start the Node server
CMD ["npm", "start"]
