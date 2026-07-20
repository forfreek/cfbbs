import { describe, expect, it } from "vitest";

import {
  boardGroups,
  loadPublicHome,
  parseHomeSort,
  publicHomeQueries,
} from "@/modules/forum/home/service";

describe("public home data", () => {
  it("queries only public local published threads and ignores private board ancestry", () => {
    expect(publicHomeQueries.publicTopicQuery).toContain(
      "first_post.origin = 'local'",
    );
    expect(publicHomeQueries.publicTopicQuery).toContain(
      "first_post.visibility = 'public'",
    );
    expect(publicHomeQueries.publicTopicQuery).toContain(
      "first_post.state = 'published'",
    );
    expect(publicHomeQueries.publicTopicQuery).toContain(
      "ancestor.visibility != 'public'",
    );
  });

  it("counts only visible published replies when rendering topic metadata", () => {
    expect(publicHomeQueries.publicTopicQuery).toContain(
      "reply.visibility = 'public'",
    );
    expect(publicHomeQueries.publicTopicQuery).toContain(
      "reply.state = 'published'",
    );
    expect(publicHomeQueries.publicTopicQuery).not.toContain(
      "threads.post_count",
    );
  });

  it("uses fixed SQL variants for supported home topic sorts", () => {
    expect(parseHomeSort("active")).toBe("active");
    expect(parseHomeSort("unreplied")).toBe("unreplied");
    expect(parseHomeSort("unexpected")).toBe("latest");
    expect(publicHomeQueries.activeTopicQuery).toContain(
      "ORDER BY threads.is_pinned DESC, replyCount DESC, activityAt DESC",
    );
    expect(publicHomeQueries.unrepliedTopicQuery).toContain("AND NOT EXISTS (");
  });

  it("returns the public query results without adding sample content", async () => {
    const result = await loadPublicHome({
      prepare(query) {
        return {
          async all() {
            return {
              results: query.includes("FROM boards")
                ? [
                    {
                      id: "general",
                      parentId: null,
                      slug: "general",
                      title: "综合讨论",
                      mode: "posting",
                    },
                  ]
                : [],
            };
          },
        };
      },
    } as D1Database);

    expect(result).toEqual({
      boards: [
        {
          id: "general",
          parentId: null,
          slug: "general",
          title: "综合讨论",
          mode: "posting",
        },
      ],
      topics: [],
    });
  });

  it("preserves hierarchy and supports arbitrary board depth", () => {
    expect(
      boardGroups([
        {
          id: "root",
          parentId: null,
          slug: "root",
          title: "根板块",
          mode: "container",
        },
        {
          id: "child",
          parentId: "root",
          slug: "child",
          title: "子板块",
          mode: "posting",
        },
        {
          id: "grandchild",
          parentId: "child",
          slug: "grandchild",
          title: "孙板块",
          mode: "read_only",
        },
      ]),
    ).toEqual([
      {
        board: {
          id: "root",
          parentId: null,
          slug: "root",
          title: "根板块",
          mode: "container",
        },
        items: [
          {
            id: "child",
            parentId: "root",
            slug: "child",
            title: "子板块",
            mode: "posting",
            depth: 0,
          },
          {
            id: "grandchild",
            parentId: "child",
            slug: "grandchild",
            title: "孙板块",
            mode: "read_only",
            depth: 1,
          },
        ],
      },
    ]);
  });
});
