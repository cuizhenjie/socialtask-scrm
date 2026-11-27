-- Apply once to an existing SocialTask workspace before switching to Next.js.
BEGIN;
CREATE TABLE IF NOT EXISTS public.socialtask_job_leases (
  job text PRIMARY KEY,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.socialtask_job_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.socialtask_job_leases FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.socialtask_bootstrap_admin(p_username text, p_hash text)
RETURNS boolean LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.users) THEN
    RETURN false;
  END IF;
  INSERT INTO public.users(username, password_hash, role) VALUES (p_username, p_hash, 'admin');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.socialtask_register_attachment(
  p_actor bigint, p_purpose text, p_filename text, p_key text, p_mime text,
  p_size bigint, p_retention timestamptz
) RETURNS bigint LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.attachments(owner_user_id,purpose,filename,storage_key,mime,file_size,retention_until)
    VALUES (p_actor,p_purpose,p_filename,p_key,p_mime,p_size,p_retention) RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(actor_user_id,entity,entity_id,action,after_json)
    VALUES (p_actor,'attachment',v_id::text,'UPLOAD',jsonb_build_object('purpose',p_purpose,'size',p_size));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.socialtask_record_attachment_purge(p_id bigint)
RETURNS boolean LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_purpose text;
BEGIN
  UPDATE public.attachments SET purged_at=CURRENT_TIMESTAMP,file_size=0
    WHERE id=p_id AND purged_at IS NULL RETURNING purpose INTO v_purpose;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.audit_logs(actor_user_id,entity,entity_id,action,after_json)
    VALUES (NULL,'attachment',p_id::text,'RETENTION_PURGE',jsonb_build_object('purpose',v_purpose));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.socialtask_bootstrap_admin(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.socialtask_register_attachment(bigint,text,text,text,text,bigint,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.socialtask_record_attachment_purge(bigint) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
