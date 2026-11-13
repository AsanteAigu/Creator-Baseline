import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-5 w-56" />
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-24" />
      <Skeleton className="h-20" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[230px]" />
        ))}
      </div>
    </>
  );
}
