# The parser as a standalone container.
#
# The service also deploys to Vercel as its own project (api/index.py), which
# is the default. This is kept for the case Vercel stops suiting it: a bulk
# import, a BOE over the 4.5MB request limit, or a parse that outgrows the
# function timeout. The Python is identical either way.
#
# Build from the repo root:
#   docker build -f backend/Dockerfile -t boe-parser .
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/

ENV PORT=8080
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
