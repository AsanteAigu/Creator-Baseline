/**
 * Creates a real workspace and its members. The app has no sign-up page (members are added
 * by an admin), so this is how the first owner, and anyone after them, gets in.
 *
 *   pnpm workspace:create --name "Agency" --owner a@agency.com [--admin b@x.com] [--viewer c@x.com]
 *
 * Re-runnable: an existing workspace with that name is reused, existing users keep their
 * password, and a member's role is updated in place. New users are created in Supabase Auth
 * with a password typed at a hidden prompt (or NEW_USER_PASSWORD when there is no terminal),
 * so the password never appears in shell history or output.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { createInterface } from "node:readline";
import { requireDatabaseUrl } from "./env";

type Role = "owner" | "admin" | "viewer";
interface Member {
  email: string;
  role: Role;
}

const MIN_PASSWORD_LENGTH = 12;

function parseArgs(argv: string[]): { name: string; members: Member[] } {
  let name: string | null = null;
  const members: Member[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1]?.trim();
    if (value === undefined || value === "" || value.startsWith("--")) fail(`${flag} needs a value`);
    if (flag === "--name") name = value;
    else if (flag === "--owner" || flag === "--admin" || flag === "--viewer") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) fail(`not an email address: ${value}`);
      members.push({ email: value.toLowerCase(), role: flag.slice(2) as Role });
    } else fail(`unknown option ${flag}`);
    i++;
  }
  if (name === null || name.length > 120) fail("--name is required (1-120 characters)");
  if (!members.some((m) => m.role === "owner")) fail("at least one --owner is required");
  return { name, members };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads a line without echoing it, so a password is not left on screen. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void });
    write._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function newUserPassword(email: string): Promise<string> {
  const fromEnv = process.env.NEW_USER_PASSWORD;
  const password = process.stdin.isTTY
    ? await promptHidden(`Password for new user ${email}: `)
    : (fromEnv ?? fail("No terminal to prompt in: set NEW_USER_PASSWORD for new users."));
  if (password.length < MIN_PASSWORD_LENGTH) fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (process.stdin.isTTY) {
    const again = await promptHidden("Repeat password: ");
    if (again !== password) fail("Passwords did not match.");
  }
  return password;
}

async function ensureUser(admin: SupabaseClient, existing: Map<string, string>, email: string): Promise<string> {
  const found = existing.get(email);
  if (found !== undefined) {
    console.log(`existing user ${email}`);
    return found;
  }
  const password = await newUserPassword(email);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) fail(`could not create ${email}: ${error?.message ?? "no user returned"}`);
  console.log(`created user ${email}`);
  return data.user.id;
}

async function listUsersByEmail(admin: SupabaseClient): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`could not list users: ${error.message}`);
    for (const u of data.users) if (u.email) out.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 1000) return out;
  }
}

async function main(): Promise<void> {
  const { name, members } = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const existingUsers = await listUsersByEmail(admin);
  const userIds = new Map<string, string>();
  for (const m of members) userIds.set(m.email, await ensureUser(admin, existingUsers, m.email));

  const sql = postgres(requireDatabaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const matches = await tx<{ id: string }[]>`select id from public.workspaces where name = ${name}`;
      if (matches.length > 1) throw new Error(`more than one workspace is named "${name}"`);
      let workspaceId = matches[0]?.id;
      if (workspaceId === undefined) {
        const [row] = await tx<{ id: string }[]>`insert into public.workspaces (name) values (${name}) returning id`;
        if (!row) throw new Error("workspace insert returned nothing");
        workspaceId = row.id;
        // Column defaults hold the scoring defaults (BUILD_PROMPT §5).
        await tx`insert into public.scoring_settings (workspace_id) values (${workspaceId})`;
        console.log(`created workspace "${name}"`);
      } else {
        console.log(`using existing workspace "${name}"`);
      }
      for (const m of members) {
        await tx`
          insert into public.workspace_members (workspace_id, user_id, role)
          values (${workspaceId}, ${userIds.get(m.email) ?? null}, ${m.role})
          on conflict (workspace_id, user_id) do update set role = excluded.role
        `;
        console.log(`  ${m.role.padEnd(6)} ${m.email}`);
      }
    });
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  // Message only: a driver error can carry the connection string.
  console.error(err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<database url>") : "failed");
  process.exit(1);
});
