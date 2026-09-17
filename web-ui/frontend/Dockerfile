FROM node:20-slim

WORKDIR /app

COPY package.json tsconfig.json next.config.mjs* ./
COPY app ./app
COPY components ./components

RUN npm install --no-audit --no-fund
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
