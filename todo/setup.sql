-- Run this once in Supabase SQL Editor (project udirnxilxlvhkzbgpjke)
-- Creates the todo table + policies so the /todo website and cron job
-- can read/write with the existing public "anon"/publishable key.

create table if not exists public.site_todos (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  source text default '',
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.site_todos enable row level security;

-- Allow the publishable/anon key to read, insert, and update (same pattern
-- as the existing mt_invoices / mt_notes tables used by moneytracker).
create policy "todos_select_anon" on public.site_todos
  for select using (true);

create policy "todos_insert_anon" on public.site_todos
  for insert with check (true);

create policy "todos_update_anon" on public.site_todos
  for update using (true);

create policy "todos_delete_anon" on public.site_todos
  for delete using (true);
