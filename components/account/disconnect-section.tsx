import { DisconnectButton } from "@/components/account/disconnect-button";

export function DisconnectSection({ creatorId, name }: { creatorId: string; name: string }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-[#d03b3b]/20 bg-card p-5 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="max-w-2xl">
        <h2 className="font-display text-[17px] font-medium tracking-tight">Disconnect this account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deletes this creator&apos;s posts, metrics, scores, reports and plans, and revokes the access token at Meta.
          Past figures cannot be recovered.
        </p>
      </div>
      <DisconnectButton creatorId={creatorId} name={name} />
    </section>
  );
}
