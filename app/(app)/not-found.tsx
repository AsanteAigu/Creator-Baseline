import Link from "next/link";
import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <EmptyState title="We couldn't find that account.">
      It may have been disconnected, or it belongs to another agency.{" "}
      <Link href="/dashboard" className="underline underline-offset-4">
        Back to all accounts
      </Link>
    </EmptyState>
  );
}
