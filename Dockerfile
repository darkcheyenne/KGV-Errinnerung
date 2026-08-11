FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
ENV DB_PATH=/app/data/kgv.db

EXPOSE 3000

CMD ["node", "server.js"]
