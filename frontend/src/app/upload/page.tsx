import Link from "next/link";
import { PdfUploadPanel } from "@/components/PdfUploadPanel";

/**
 * Uploading a Bill of Entry.
 *
 * This used to offer a second tab, "Enter manually", which wrote a BOE and
 * its items straight to the database from the browser. That was deliberate --
 * it existed as the fallback for when the parser could not read a PDF, so it
 * could not depend on the parser being reachable.
 *
 * It was removed when the anon key lost write access. The key ships in this
 * page's source, so any table the browser can write is a table anyone with
 * the URL can write, and these hold the import records themselves. The
 * feature was the last thing keeping insert and delete open on them.
 *
 * To bring it back, route it through the parser service, which holds the
 * service_role key -- not by reopening those tables to the browser.
 */
export default function AddRecordPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Import records
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight">Add an import record</h1>
      <p className="mt-1.5 text-sm text-muted">
        Upload the ICEGATE Bill of Entry and it is read automatically.
      </p>

      <div className="mt-8">
        <PdfUploadPanel />
      </div>
    </main>
  );
}
