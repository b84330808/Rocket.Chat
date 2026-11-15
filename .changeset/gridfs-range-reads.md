---
'@rocket.chat/meteor': patch
---

Fixes byte-range requests for files stored in GridFS reading the file from its first byte. Playing or seeking a video or audio file now reads only the chunks that the requested range covers, instead of up to the whole file from the database on each request.
