-- Storage limits: a size ceiling per file and the file types each private
-- bucket stores (hardening review, batch 4). The buckets were created with
-- only (id, name, public), so anything up to the project-wide maximum could
-- be uploaded to the public funnel's photo bucket, HTML and executables
-- included. Supabase Storage enforces both columns on every upload, signed
-- URLs and the service role alike.
--
-- Keep in step with apps/web/lib/storage-buckets.ts (BUCKET_RULES), which the
-- upload routes and the local data backend use; tests/storage-buckets.test.ts
-- compares the two. Safe to re-run: it only sets the two columns.

-- The quote funnel's survey photos (shrunk to JPEG on the phone first).
update storage.buckets
set file_size_limit = 26214400, -- 25 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'survey-photos';

-- The capture app's walkthrough videos.
update storage.buckets
set file_size_limit = 52428800, -- 50 MB
    allowed_mime_types = array['video/mp4', 'video/quicktime']
where id = 'survey-videos';

-- Staff and field media: photos, PDFs (certificates, the customer's emails),
-- short phone videos, and SVG, which only the system stores (generated
-- drawings, DEMO photos).
update storage.buckets
set file_size_limit = 26214400, -- 25 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'video/mp4', 'video/quicktime', 'image/svg+xml']
where id = 'project-media';
