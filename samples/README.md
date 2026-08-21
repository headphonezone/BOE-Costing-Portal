# Samples

Put a real ICEGATE Bill of Entry PDF here to test the pipeline end to end:
upload it on the portal's **Upload BOE** page and check the parsed record.

**Nothing in this folder is committed except this file.** A Bill of Entry is a
commercial record — it carries the importer's address, IEC and GSTIN, the
supplier, unit prices and duty amounts. Those do not belong in a repository.

A good test file is one that exercises the awkward parts:

- more than one invoice on the same BOE, so item numbering restarts at 1
- at least one item cleared against a licence, where cash BCD is 0 and the
  real figure sits in Part IV Section G
- an "ASSESSED COPY" watermark, which bleeds stray letters into descriptions
