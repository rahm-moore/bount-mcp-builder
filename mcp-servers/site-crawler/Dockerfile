# Base image ships Chromium + all Playwright OS deps preinstalled.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install --no-audit --no-fund
RUN npm run build

ENV MCP_SECRETS_BACKEND=local
ENV MCP_TRANSPORT=streamable-http
ENV PORT=8802
# credential-resolver.ts's default profiles.json path is computed relative
# to its own file location, assuming the full monorepo checkout's
# directory depth. That assumption doesn't hold in this image (just src/
# copied to /app), so point it explicitly at where docker-compose.yml
# mounts secrets/.
ENV MCP_PROFILES_PATH=/app/secrets/profiles.json
EXPOSE 8802

CMD ["node", "dist/index.js"]
