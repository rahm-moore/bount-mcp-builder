FROM node:20-slim

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install --no-audit --no-fund
RUN npm run build

ENV MCP_TRANSPORT=streamable-http
ENV PORT=8800
EXPOSE 8800

CMD ["node", "dist/router.js"]
