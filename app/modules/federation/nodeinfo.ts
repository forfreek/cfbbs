import type { NodeInfo } from "@fedify/fedify";

export type NodeInfoDocument = NodeInfo & { readonly version: "2.1" };

export function nodeInfoDocument(origin: string): NodeInfoDocument {
  return {
    version: "2.1",
    software: { name: "cfbbs", version: "0.1.0" },
    protocols: ["activitypub"],
    services: { inbound: [], outbound: [] },
    openRegistrations: true,
    usage: {
      users: { total: 0, activeMonth: 0, activeHalfyear: 0 },
      localPosts: 0,
      localComments: 0,
    },
    metadata: { nodeName: new URL(origin).host },
  };
}
