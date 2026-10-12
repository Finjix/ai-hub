import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { streamFile } from "./file-response";

describe("download range responses", () => {
  let directory = "";
  let file = "";

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "ai-hub-range-"));
    file = path.join(directory, "artifact.bin");
    await writeFile(file, "0123456789");
  });

  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it("streams the requested byte interval with a 206 response", async () => {
    const request = new Request("http://ai-hub.local/update", { headers: { range: "bytes=2-5" } });
    const response = await streamFile(file, request);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("2345");
  });

  it("supports suffix ranges and rejects ranges past the end", async () => {
    const suffix = await streamFile(file, new Request("http://ai-hub.local/update", { headers: { range: "bytes=-3" } }));
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("789");
    const invalid = await streamFile(file, new Request("http://ai-hub.local/update", { headers: { range: "bytes=10-" } }));
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */10");
    expect(invalid.headers.get("content-length")).toBe("0");
  });

  it("lets callers override the content type for inline media", async () => {
    const response = await streamFile(file, undefined, undefined, { "Content-Type": "video/mp4" });
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toBeNull();
  });
});
