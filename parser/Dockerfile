# The parser as a standalone container.
#
# Not needed for Vercel -- parser/ deploys there as its own project with
# parser/ as the root directory. This is the escape hatch if Vercel stops
# suiting it: a bulk import, a BOE over the 4.5MB request limit, or a parse
# that outgrows the function timeout. The Python is identical either way.
#
# Build from this folder:
#   docker build -f parser/Dockerfile -t boe-parser parser/
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/

ENV PORT=8080
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
