"""
One-time migration: copies every document already sitting in Supabase
Storage (bucket "boe-documents") into the "BOE Costing Portal" Google Drive
Shared Drive, then repoints the DB rows at the new Drive file IDs and
removes the file from Supabase Storage -- freeing the quota that motivated
this move in the first place.

Safe to re-run: a row whose storage_path is already a Drive file ID (no "/")
is skipped, so an interrupted run picks up where it left off rather than
re-migrating or double-uploading anything.

Run from parser/ with the same environment as the backend
(SUPABASE_URL, SUPABASE_KEY, GOOGLE_SERVICE_ACCOUNT_JSON):

    python -m scripts.migrate_docs_to_drive           # dry run, no writes
    python -m scripts.migrate_docs_to_drive --apply    # actually migrate
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import drive_client  # noqa: E402
from backend.supabase_client import _client  # noqa: E402

# The bucket documents lived in before this migration. supabase_client.py no
# longer references it -- new uploads go straight to Drive -- so it's kept
# here, local to the one script that still needs it.
DOCS_BUCKET = "boe-documents"


def _is_legacy_path(storage_path: str) -> bool:
    return "/" in storage_path


def migrate(apply: bool) -> None:
    docs = _client.table("boe_documents").select("*").execute().data
    legacy = [d for d in docs if d.get("storage_path") and _is_legacy_path(d["storage_path"])]

    print(f"{len(docs)} boe_documents rows total, {len(legacy)} still on Supabase Storage.")
    if not legacy:
        print("Nothing to migrate.")
        return

    migrated, failed = 0, 0
    for doc in legacy:
        be_no = doc["be_no"]
        old_path = doc["storage_path"]
        doc_type = doc.get("doc_type") or "BOE"
        file_name = doc.get("file_name") or old_path.rsplit("/", 1)[-1]

        print(f"[{be_no}] {old_path} ({doc_type}) -> Drive ...", end=" ")
        if not apply:
            print("dry run, skipped")
            continue

        try:
            file_bytes = _client.storage.from_(DOCS_BUCKET).download(old_path)
            new_id = drive_client.upload_document(be_no, file_name, file_bytes, doc_type)

            _client.table("boe_documents").update({"storage_path": new_id}).eq("id", doc["id"]).execute()
            # boe_document_extractions is keyed by storage_path (see
            # save_document_extraction) -- without repointing it too, the
            # get_boe() join silently loses this document's extracted fields.
            _client.table("boe_document_extractions").update({"storage_path": new_id}) \
                .eq("be_no", be_no).eq("storage_path", old_path).execute()

            _client.storage.from_(DOCS_BUCKET).remove([old_path])
            print(f"done ({new_id})")
            migrated += 1
        except Exception as e:
            print(f"FAILED: {e}")
            failed += 1

    print(f"\n{migrated} migrated, {failed} failed, {len(legacy) - migrated - failed} skipped (dry run).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually migrate (default is dry run).")
    args = parser.parse_args()
    migrate(apply=args.apply)
