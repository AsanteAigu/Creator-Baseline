import { PostRow, type PostRowData } from "@/components/account/post-row";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PostListCard({
  title,
  description,
  empty,
  posts,
  emphasis,
}: {
  title: string;
  description: string;
  empty: string;
  posts: PostRowData[];
  emphasis: "max" | "min";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {posts.length > 0 ? (
          <ul className="divide-y divide-border">
            {posts.map((p) => (
              <PostRow key={p.id} post={p} emphasis={emphasis} />
            ))}
          </ul>
        ) : (
          <EmptyState title={empty} />
        )}
      </CardContent>
    </Card>
  );
}
