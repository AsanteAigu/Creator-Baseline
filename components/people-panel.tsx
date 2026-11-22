"use client";

import { Check, Copy, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { callApi } from "./api-client";

export interface PersonRow {
  userId: string;
  email: string | null;
  role: string;
  creatorUsername: string | null;
  isYou: boolean;
}

export interface InviteRow {
  id: string;
  email: string;
  role: string;
  expiresLabel: string;
}

const ROLE_HELP: Record<string, string> = {
  admin: "Admin: sees every account, connects accounts, changes settings and invites people.",
  viewer: "Viewer: sees every account, changes nothing.",
  creator: "Creator: connects their own Instagram and sees only that account.",
};

const ROLE_NAMES: Record<string, string> = { owner: "Owner", admin: "Admin", viewer: "Viewer", creator: "Creator" };

/** Owner/admin only: the page decides whether to render it; the API re-checks every call. */
export function PeoplePanel({ people, invites }: { people: PersonRow[]; invites: InviteRow[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("creator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await callApi<{ email: string; link: string }>("/api/settings/invites", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.fields?.email ?? res.message);
      return;
    }
    setCreated({ email: res.data.email, link: res.data.link });
    setEmail("");
    router.refresh();
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function remove(url: string, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setError(null);
    const res = await callApi<void>(url, { method: "DELETE" });
    if (!res.ok) setError(res.message);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
        <CardDescription>
          Invite someone by email, then send them the link (WhatsApp, email, anything). They set their own password.
          Links work once and expire after 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={invite} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-base shadow-[inset_0_1px_1px_rgb(16_24_40/0.03)] hover:border-foreground/20 focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/12 sm:text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="creator">Creator</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button type="submit" disabled={busy}>
            <UserPlus aria-hidden />
            {busy ? "Creating…" : "Create invite link"}
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-3">{ROLE_HELP[role]}</p>
        </form>

        {error ? (
          <p role="alert" className="text-sm text-[#9f1f1f]">
            {error}
          </p>
        ) : null}

        {created ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-sm">
              Invite link for <span className="font-medium">{created.email}</span>. Copy it now: it is only shown once.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
              <Button type="button" variant="outline" onClick={() => copy(created.link)}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Members</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {p.email ?? "Unknown email"}
                  {p.isYou ? <span className="text-muted-foreground"> (you)</span> : null}
                </span>
                <Badge tone="info">{ROLE_NAMES[p.role] ?? p.role}</Badge>
                {p.role === "creator" ? (
                  <span className="text-xs text-muted-foreground">
                    {p.creatorUsername ? `@${p.creatorUsername}` : "Instagram not connected yet"}
                  </span>
                ) : null}
                {!p.isYou ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${p.email ?? "member"}`}
                    onClick={() =>
                      remove(
                        `/api/settings/members/${p.userId}`,
                        `Remove ${p.email ?? "this person"}? They lose access straight away. Connected accounts and their data stay.`,
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {invites.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Pending invites</h3>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <Badge tone="info">{ROLE_NAMES[i.role] ?? i.role}</Badge>
                  <span className="text-xs text-muted-foreground">Expires {i.expiresLabel}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Cancel invite for ${i.email}`}
                    onClick={() => remove(`/api/settings/invites/${i.id}`, `Cancel the invite for ${i.email}? The link stops working.`)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
