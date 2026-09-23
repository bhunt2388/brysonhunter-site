-- Run this in Supabase SQL Editor to fix the delete policy.
-- (An earlier attempt likely created a policy named todos_delete_anon with
-- a bad/blocking condition, which is why "create policy" said it already
-- existed but deletes still silently do nothing.)

drop policy if exists "todos_delete_anon" on public.site_todos;

create policy "todos_delete_anon" on public.site_todos
  for delete
  to anon, authenticated
  using (true);

-- Sanity check: this should return the policy with cmd = 'DELETE' and
-- qual = 'true'
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.site_todos'::regclass;
