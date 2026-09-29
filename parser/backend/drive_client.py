"""
Google Drive storage for BOE documents, replacing Supabase Storage (whose
free-tier quota the raw PDFs were filling up -- the parsed *data* stays in
Supabase Postgres, only the file bytes move here).

Files land in the "BOE Costing Portal" Shared Drive
(https://drive.google.com/drive/folders/0ANYmOvcEM4JYUk9PVA), one subfolder
per doc_type, so the Drive UI mirrors the doc_type breakdown already used
throughout the app. Credentials are a Google Cloud service account, added as
a Content Manager member of that Shared Drive -- which is why deletes here
use trash (files.update trashed=true) rather than files.delete: a Content
Manager can trash but not permanently delete, so a mistaken removal lands in
the Shared Drive's trash instead of vanishing outright.
"""
import io
import json
import os

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaInMemoryUpload

SHARED_DRIVE_ID = os.environ.get("GOOGLE_DRIVE_SHARED_DRIVE_ID", "0ANYmOvcEM4JYUk9PVA")

# One subfolder per doc_type, all inside the Shared Drive above.
_FOLDER_IDS = {
    "BOE": os.environ.get("GOOGLE_DRIVE_FOLDER_BOE", "1EeLUz02USnDnSd7BEVhN1M0b5iZZavOH"),
    "INVOICE": os.environ.get("GOOGLE_DRIVE_FOLDER_INVOICE", "1ZnB_LYQ-ndRAOiPoHWidYylS9YWhlgfZ"),
    "PACKING_LIST": os.environ.get("GOOGLE_DRIVE_FOLDER_PACKING_LIST", "1K6V8bqoMWjiLeBCITz9O4MVVrnJ2dDGQ"),
    "COO": os.environ.get("GOOGLE_DRIVE_FOLDER_COO", "10Zm4TJvDXP8PB7zzFXwypV7l598S_X2F"),
    "DEBIT_ADVICE": os.environ.get("GOOGLE_DRIVE_FOLDER_DEBIT_ADVICE", "172YNFNRdfE8WSoh72LtHxgPetxaEtAc9"),
}


def _folder_for(doc_type: str) -> str:
    folder_id = _FOLDER_IDS.get(doc_type)
    if not folder_id:
        raise ValueError(f"No Drive folder configured for doc_type: {doc_type}")
    return folder_id


def _build_service():
    # GOOGLE_SERVICE_ACCOUNT_JSON carries the whole key file as one string --
    # the only form that survives a paste into Vercel's env var UI (a file
    # path, as used in local dev, doesn't exist in that serverless runtime).
    raw = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/drive"]
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


_service = None


def _drive():
    global _service
    if _service is None:
        _service = _build_service()
    return _service


def upload_document(be_no: str, file_name: str, file_bytes: bytes, doc_type: str = "BOE") -> str:
    """
    Uploads a supporting document into the doc_type's Drive subfolder.
    Returns the Drive file ID, which is what boe_documents.storage_path
    stores from here on (the column name is unchanged to avoid touching
    every read site, even though it's no longer a Supabase Storage path).
    """
    folder_id = _folder_for(doc_type)
    content_type = "application/pdf" if file_name.lower().endswith(".pdf") else "application/octet-stream"
    # be_no is prefixed onto the Drive file name (Drive allows duplicate
    # names, unlike Storage's path-keyed uniqueness) so the same file_name
    # from two different BOEs stays distinguishable in the Drive UI.
    drive_name = f"{be_no}__{file_name}"

    existing = _drive().files().list(
        q=(
            f"'{folder_id}' in parents and name = '{drive_name}' "
            "and trashed = false"
        ),
        corpora="drive", driveId=SHARED_DRIVE_ID,
        includeItemsFromAllDrives=True, supportsAllDrives=True,
        fields="files(id)",
    ).execute().get("files", [])

    media = MediaInMemoryUpload(file_bytes, mimetype=content_type, resumable=False)

    if existing:
        # Re-uploading the same BOE (e.g. after a parser fix) should replace
        # the file in place, same as the old Storage upsert -- not pile up
        # duplicate Drive files under the same name.
        file_id = existing[0]["id"]
        _drive().files().update(
            fileId=file_id, media_body=media, supportsAllDrives=True,
        ).execute()
        return file_id

    created = _drive().files().create(
        body={"name": drive_name, "parents": [folder_id]},
        media_body=media, fields="id", supportsAllDrives=True,
    ).execute()
    return created["id"]


def download_document(file_id: str) -> bytes:
    """Downloads a document's bytes by Drive file ID. Used by the one-time
    Supabase -> Drive migration script and nowhere else in normal operation."""
    request = _drive().files().get_media(fileId=file_id, supportsAllDrives=True)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


def trash_document(file_id: str) -> None:
    """
    Moves a file to the Shared Drive's trash. Not a permanent delete: the
    service account's Content Manager role can trash but not permanently
    delete, which is a safety net, not a limitation to work around -- a
    mistaken removal (including the debit-advice undo flow) is recoverable
    from the Shared Drive's trash rather than gone outright.
    """
    try:
        _drive().files().update(
            fileId=file_id, body={"trashed": True}, supportsAllDrives=True,
        ).execute()
    except Exception:
        # A file already trashed/removed manually shouldn't block deleting
        # the BOE record that referenced it.
        pass


def view_link(file_id: str) -> str:
    """A Drive file's standard view URL. No API call needed -- Drive's link
    format is deterministic from the file ID alone. Access is governed by
    the Shared Drive's own sharing (org members with access), not a signed
    URL, since Drive has no per-request signing mechanism like Supabase
    Storage does."""
    return f"https://drive.google.com/file/d/{file_id}/view"
