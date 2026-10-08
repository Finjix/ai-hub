import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStore } from "./db";
import { listSkills } from "./skills";

describe("skill search", () => {
  const previousDataDir = process.env.AI_HUB_DATA_DIR;
  let directory = "";
  let store: ReturnType<typeof getStore>;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "ai-hub-search-"));
    process.env.AI_HUB_DATA_DIR = directory;
    if (globalThis.__aiHubStore) globalThis.__aiHubStore.db.close();
    globalThis.__aiHubStore = undefined;
    store = getStore();
    const insert = store.db.prepare(`INSERT INTO skills
      (id,name,display_name,description,category,tags_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?, 'active', ?, ?)`);
    const now = new Date().toISOString();
    insert.run("11111111-1111-4111-8111-111111111111", "literal-search", "Literal 100%_needle", "", "测试", "[]", now, now);
    insert.run("22222222-2222-4222-8222-222222222222", "wildcard-search", "Literal 100xZneedle", "", "测试", "[]", now, now);
  });

  afterAll(async () => {
    store?.db.close();
    globalThis.__aiHubStore = undefined;
    if (previousDataDir === undefined) delete process.env.AI_HUB_DATA_DIR;
    else process.env.AI_HUB_DATA_DIR = previousDataDir;
    await rm(directory, { recursive: true, force: true });
  });

  it("treats percent and underscore in a search term literally", () => {
    expect(listSkills({ q: "%_needle", admin: true }).skills.map((skill) => skill.name)).toEqual(["literal-search"]);
  });
});
