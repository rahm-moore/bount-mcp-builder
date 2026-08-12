# Base image ships Chromium + all Playwright OS deps preinstalled.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install --no-audit --no-fund
RUN npm run build

ENV MCP_SECRETS_BACKEND=local
EXPOSE 8802

CMD ["node", "dist/index.js"]
