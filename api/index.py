"""
Vercel entry point for the parser service.

This is its own Vercel project, separate from the portal, and it exists as a
separate project for a concrete reason: a Next.js app and a Python function
both want to own `/api/*`, and inside one project Next wins -- every request
was answered by Next's 404 and then its 500 page, never reaching Python.

A project with no framework has nothing competing for the path, so the
catch-all rewrite in vercel.json can hand every request straight to the ASGI
app below.

Nothing is mounted or re-prefixed here. The app keeps the exact routes it
serves locally -- /boe/upload, /boe/{be_no}/excel and the rest -- so the URL
the portal calls differs only by host, and local development and production
exercise identical paths.
"""
from backend.main import app

__all__ = ["app"]
