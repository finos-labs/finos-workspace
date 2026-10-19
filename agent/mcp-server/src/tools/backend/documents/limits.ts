/**
 * What one document, one chat and one user may cost the document search.
 *
 * Reading a document, chunking it and embedding it uses the machine and the operator's embedding key, for
 * whoever uploads it. Every figure here is a ceiling for a document, a chat or a user, checked before the
 * work that costs money is done.
 */

/** Most pages of a PDF that are read. */
export const MAX_PDF_PAGES = 1_500;
/** Most characters of text read from one document. */
export const MAX_EXTRACTED_CHARS = 8_000_000;
/** Most chunks of one document (and of a chat: see store.ts). */
export const MAX_CHUNKS_PER_DOC = 5_000;
/** Longest a chunk may be, in characters, however the text is broken up (an unbroken text has no sentences to cut at). */
export const MAX_CHUNK_CHARS = 8_000;
/** Longest the child process that reads and chunks a document may take. */
export const INGEST_TIMEOUT_MS = 90_000;
