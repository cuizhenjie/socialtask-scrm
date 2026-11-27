-- V11: Supabase security hardening (Volcengine Ark Agent Plan Supabase / PostgreSQL).
-- Enable RLS on all public schema tables and deny direct anon/authenticated Data API access;
-- SocialTask Spring Boot API accesses PostgreSQL directly with server-side RBAC.
DO $$
DECLARE
 tbl RECORD;
BEGIN
 -- 只处理当前角色拥有的对象：Supabase 的 public schema 可能含有平台创建的表
 -- （例如 health_check，owner 为 supabase_admin），对它们执行 ALTER 会报 42501。
 FOR tbl IN
  SELECT c.relname AS name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND pg_get_userbyid(c.relowner) = current_user
    AND c.relname <> 'flyway_schema_history'
 LOOP
  BEGIN
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.name);
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl.name);
   END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl.name);
   END IF;
  EXCEPTION WHEN insufficient_privilege THEN
   RAISE NOTICE '跳过 RLS/权限收紧（当前角色不是 % 的 owner）', tbl.name;
  END;
 END LOOP;

 FOR tbl IN
  SELECT c.relname AS name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'S'
    AND pg_get_userbyid(c.relowner) = current_user
 LOOP
  BEGIN
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', tbl.name);
   END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM authenticated', tbl.name);
   END IF;
  EXCEPTION WHEN insufficient_privilege THEN
   RAISE NOTICE '跳过序列权限收紧：%', tbl.name;
  END;
 END LOOP;
END
$$;
