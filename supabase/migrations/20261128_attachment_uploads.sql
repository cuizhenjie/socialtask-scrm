-- Apply after 20261127_next_runtime.sql. No existing attachment ID/key is changed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.socialtask_attachment_uploads (
  owner_user_id bigint NOT NULL REFERENCES public.users(id),
  request_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{64}$'),
  retention_until timestamptz,
  attachment_id bigint UNIQUE REFERENCES public.attachments(id),
  expires_at timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '24 hours'),
  cleanup_only boolean NOT NULL DEFAULT false,
  cleaned_at timestamptz,
  PRIMARY KEY (owner_user_id, request_id)
);
ALTER TABLE public.socialtask_attachment_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.socialtask_attachment_uploads FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS ix_socialtask_unfinished_uploads ON public.socialtask_attachment_uploads(expires_at)
  WHERE attachment_id IS NULL AND cleaned_at IS NULL;

CREATE OR REPLACE FUNCTION public.socialtask_finish_upload(
  p_owner bigint, p_request uuid, p_fingerprint text,
  p_purpose text, p_filename text, p_mime text, p_size bigint
) RETURNS bigint LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_upload public.socialtask_attachment_uploads%ROWTYPE;
        v_id bigint;
BEGIN
  SELECT * INTO v_upload FROM public.socialtask_attachment_uploads
    WHERE owner_user_id=p_owner AND request_id=p_request FOR UPDATE;
  IF NOT FOUND OR v_upload.cleanup_only OR v_upload.fingerprint<>p_fingerprint THEN
    RETURN NULL;
  END IF;
  IF v_upload.attachment_id IS NOT NULL THEN RETURN v_upload.attachment_id; END IF;
  v_id := public.socialtask_register_attachment(
    p_owner,p_purpose,p_filename,v_upload.storage_key,p_mime,p_size,v_upload.retention_until);
  UPDATE public.socialtask_attachment_uploads SET attachment_id=v_id
    WHERE owner_user_id=p_owner AND request_id=p_request;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.socialtask_finish_upload(bigint,uuid,text,text,text,text,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
