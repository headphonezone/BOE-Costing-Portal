"""
Vercel entry point for the parser service.

Vercel builds one project from one root directory, and this project's root is
`frontend/`. So the Python lives here, under it, and is served from the same
deployment and the same origin as the portal -- which is why the portal can
call `/api/...` on itself and needs neither NEXT_PUBLIC_API_BASE_URL nor CORS.

Everything in `_boe/` is the parser service exactly as it was; the leading
underscore is what stops Vercel publishing each of those modules as an
endpoint of its own. This file is the only function.

The app is mounted under `/api` rather than having its routes rewritten,
so every path the service already defines -- /boe/upload, /boe/{be_no}/excel
and the rest -- keeps working unchanged, just one level deeper.
"""
from fastapi import FastAPI

from _boe.main import app as parser_app

app = FastAPI(title="BOE Costing API (Vercel)")
app.mount("/api", parser_app)
