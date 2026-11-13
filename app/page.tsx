import { PRODUCT_NAME } from "@/lib/config";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
      <p className="text-muted-foreground">
        Post performance scored against each creator&apos;s own baseline.
      </p>
    </main>
  );
}
