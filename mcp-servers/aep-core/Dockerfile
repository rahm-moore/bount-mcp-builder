FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir -e .

ENV MCP_SECRETS_BACKEND=local
ENV PYTHONUNBUFFERED=1

EXPOSE 8801

CMD ["python", "-m", "aep_core.server"]
