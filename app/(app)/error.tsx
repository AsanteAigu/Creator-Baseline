"use client";

import { Banner } from "@/components/banner";
import { Button } from "@/components/ui/button";

/** Any unexpected failure in a signed-in page: a plain message and a retry, never a stack trace. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Banner
      tone="error"
      title="This page didn't load."
      action={
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      }
    >
      Please try again. If it keeps happening, let your agency admin know.
    </Banner>
  );
}
