FROM node:20-slim

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install --no-audit --no-fund
RUN npm run build

ENV MCP_TRANSPORT=streamable-http
ENV PORT=8803
EXPOSE 8803

CMD ["node", "dist/index.js"]
