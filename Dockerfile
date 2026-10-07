FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY docs ./docs
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "server/server.js"]
