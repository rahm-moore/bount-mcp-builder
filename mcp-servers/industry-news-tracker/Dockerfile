FROM node:20-slim

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install --no-audit --no-fund
RUN npm run build

EXPOSE 8803

CMD ["node", "dist/index.js"]
