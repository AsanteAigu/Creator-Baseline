import { serverEnv } from "@/lib/config";
import { GraphInstagramSource } from "./graph-source";
import { MockInstagramSource } from "./mock-source";
import type { InstagramSource } from "./types";

export function createInstagramSource(): InstagramSource {
  const env = serverEnv();
  if (env.INSTAGRAM_SOURCE === "graph") {
    // lib/config already requires these when the flag is graph; this narrows the types.
    if (
      env.INSTAGRAM_APP_ID === undefined ||
      env.INSTAGRAM_APP_SECRET === undefined ||
      env.INSTAGRAM_REDIRECT_URI === undefined
    ) {
      throw new Error(
        "INSTAGRAM_SOURCE=graph requires INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET and INSTAGRAM_REDIRECT_URI.",
      );
    }
    return new GraphInstagramSource({
      appId: env.INSTAGRAM_APP_ID,
      appSecret: env.INSTAGRAM_APP_SECRET,
      redirectUri: env.INSTAGRAM_REDIRECT_URI,
      loginType: env.INSTAGRAM_LOGIN_TYPE,
      loginConfigId: env.INSTAGRAM_LOGIN_CONFIG_ID,
    });
  }
  return new MockInstagramSource({ redirectUri: `${env.APP_BASE_URL}/api/creators/callback` });
}
