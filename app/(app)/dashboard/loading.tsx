import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-[188px] sm:h-[204px]" />
      <Skeleton className="h-[264px] lg:h-[132px]" />
      <Skeleton className="h-7 w-32" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[280px]" />
        ))}
      </div>
    </>
  );
}
