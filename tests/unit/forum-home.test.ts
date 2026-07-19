import { describe, expect, it } from "vitest";

import {
  boardGroups,
  loadPublicHome,
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
        },
      ],
      topics: [],
    });
  });

  it("preserves hierarchy and supports arbitrary board depth", () => {
    expect(
      boardGroups([
        { id: "root", parentId: null, slug: "root", title: "根板块" },
        { id: "child", parentId: "root", slug: "child", title: "子板块" },
        {
          id: "grandchild",
          parentId: "child",
          slug: "grandchild",
          title: "孙板块",
        },
      ]),
    ).toEqual([
      {
        board: { id: "root", parentId: null, slug: "root", title: "根板块" },
        items: [
          {
            id: "child",
            parentId: "root",
            slug: "child",
            title: "子板块",
            depth: 0,
          },
          {
            id: "grandchild",
            parentId: "child",
            slug: "grandchild",
            title: "孙板块",
            depth: 1,
          },
        ],
      },
    ]);
  });
});
