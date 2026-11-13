-- Settings changes and suggestion decisions are audited from the user's own session, so the
-- service role is never needed in a request path. A member may only write entries for a
-- workspace they belong to, as themselves.

grant insert (workspace_id, actor_user_id, action, subject, metadata) on public.audit_log to authenticated;

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (actor_user_id = auth.uid() and public.is_workspace_member(workspace_id));
