import { describe, expect, it } from "vitest";
import { boundedFormData, HttpError, requireSameOrigin } from "./http";

describe("admin request guards and tag parsing", () => {
  it("allows a browser write when Origin matches the request host", () => {
    const request = new Request("http://ai-hub.local/api/v1/admin/skills", {
      method: "POST",
      headers: { host: "ai-hub.local", origin: "http://ai-hub.local" },
    });
    expect(() => requireSameOrigin(request)).not.toThrow();
  });

  it("rejects a browser write from a different host", () => {
    const request = new Request("http://ai-hub.local/api/v1/admin/skills", {
      method: "POST",
      headers: { host: "ai-hub.local", origin: "http://attacker.local" },
    });
    let thrown: unknown;
    try { requireSameOrigin(request); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(HttpError);
    expect((thrown as HttpError).status).toBe(403);
  });

  it("accepts bounded multipart uploads and stops oversized streamed bodies", async () => {
    const small = new FormData();
    small.append("version", "1.2.3");
    const accepted = await boundedFormData(new Request("http://ai-hub.local/upload", { method: "POST", body: small }), 4096, "too large");
    expect(accepted.get("version")).toBe("1.2.3");

    const large = new FormData();
    large.append("payload", "x".repeat(4096));
    await expect(boundedFormData(new Request("http://ai-hub.local/upload", { method: "POST", body: large }), 1024, "upload too large"))
      .rejects.toMatchObject({ status: 413, message: "upload too large" });
  });
});
