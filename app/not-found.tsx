import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 px-4 text-center">
      <h1 className="text-lg font-semibold">We couldn&apos;t find that page.</h1>
      <p className="text-sm text-muted-foreground">
        It may have moved, or the account may have been disconnected.{" "}
        <Link href="/dashboard" className="underline underline-offset-4">
          Back to all accounts
        </Link>
      </p>
    </main>
  );
}
