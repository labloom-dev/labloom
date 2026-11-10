# Encrypted PDF test fixture

`protected.pdf` is generated from this repository's own `knownCoordinatePdf()` fixture in `pdf-text.ts`, using macOS PDFKit's `PDFDocument.write(to:withOptions:)` with `userPasswordOption="reader-pass"` and `ownerPasswordOption="owner-pass"`. It contains only synthetic text created for these tests; no third-party PDF or AGPL code is included.

It tests transient password handling, failed-password isolation, quote extraction after unlocking, and extractor-version refresh after a restart. The passwords are fixed, public test credentials.
