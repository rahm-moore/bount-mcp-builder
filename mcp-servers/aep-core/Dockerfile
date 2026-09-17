FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir -e .

ENV MCP_SECRETS_BACKEND=local
ENV MCP_TRANSPORT=streamable-http
ENV PORT=8801
# credential_resolver.py's default profiles.json path is computed relative
# to its own file location, assuming the full monorepo checkout's
# directory depth (repo-root/mcp-servers/aep-core/src/aep_core/auth/...).
# That assumption doesn't hold in this image (just src/ copied to /app),
# so point it explicitly at where docker-compose.yml mounts secrets/.
ENV MCP_PROFILES_PATH=/app/secrets/profiles.json
ENV PYTHONUNBUFFERED=1

EXPOSE 8801

CMD ["python", "-m", "aep_core.server"]
