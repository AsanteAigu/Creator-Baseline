import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-[180px]" />
      <Skeleton className="h-[180px]" />
      <Skeleton className="h-[260px]" />
      <Skeleton className="h-[180px]" />
    </>
  );
}
