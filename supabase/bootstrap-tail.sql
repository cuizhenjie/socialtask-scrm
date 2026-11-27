-- 补跑脚本：当 supabase/bootstrap.sql 因 public schema 中已存在非本角色的表（如 health_check）而中断时使用。
-- 前置条件：业务表已由 bootstrap.sql 创建成功；本脚本只补 RLS/权限与 PostgREST 网关函数，可重复执行。
-- >>>>> V11__supabase_rls.sql
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

-- =====================================================================
-- PostgREST RPC gateway (service_role only)
-- =====================================================================
-- api_query: runs a SELECT, or a DML statement with RETURNING, and returns rows as jsonb.
-- api_exec : runs a DML statement without RETURNING and returns the affected row count.
-- Both are SECURITY DEFINER and pinned to search_path=public; execute is revoked from
-- PUBLIC/anon/authenticated so browsers can never reach them with the anon key.
CREATE OR REPLACE FUNCTION public.api_query(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  statement text := btrim(p_sql, E' \t\r\n;');
  head text;
  result jsonb;
BEGIN
  IF statement IS NULL OR statement = '' THEN
    RETURN '[]'::jsonb;
  END IF;
  head := upper(left(statement, 12));
  IF head LIKE 'INSERT%' OR head LIKE 'UPDATE%' OR head LIKE 'DELETE%' OR head LIKE 'MERGE%'
     OR (head LIKE 'WITH%' AND upper(statement) LIKE '%RETURNING %') THEN
    EXECUTE 'WITH __dml AS (' || statement || ') SELECT coalesce(jsonb_agg(to_jsonb(__dml)), ''[]''::jsonb) FROM __dml'
      INTO result;
  ELSE
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(__q)), ''[]''::jsonb) FROM (' || statement || ') __q'
      INTO result;
  END IF;
  RETURN coalesce(result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_exec(p_sql text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected integer;
BEGIN
  EXECUTE btrim(p_sql, E' \t\r\n;');
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.api_query(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_exec(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.api_query(text) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.api_exec(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.api_query(text) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.api_exec(text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT EXECUTE ON FUNCTION public.api_query(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.api_exec(text) TO service_role;
  END IF;
END
$$;
