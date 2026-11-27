-- Apply once in the Ark/Supabase SQL Editor. No public Storage policy is needed.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('socialtask-attachments','socialtask-attachments',false,5242880,ARRAY['image/png','image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
