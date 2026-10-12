import { describe, expect, it } from "vitest";
import { MEDIA_LIMITS, describeMedia, isMediaFileName, mediaSizeError } from "./media";

describe("media rules", () => {
  it("classifies images and videos by extension, case-insensitively", () => {
    expect(describeMedia("shot.PNG")).toEqual({ kind: "image", extension: "png", contentType: "image/png" });
    expect(describeMedia("demo.mp4")?.kind).toBe("video");
    expect(describeMedia("logo.svg")).toBeNull();
    expect(describeMedia("archive.zip")).toBeNull();
    expect(describeMedia("noextension")).toBeNull();
  });

  it("enforces 10MB for images and 100MB for videos", () => {
    const image = describeMedia("a.jpg")!;
    const video = describeMedia("a.webm")!;
    expect(mediaSizeError(image, MEDIA_LIMITS.image)).toBeNull();
    expect(mediaSizeError(image, MEDIA_LIMITS.image + 1)).toBe("图片不能超过 10MB。");
    expect(mediaSizeError(video, MEDIA_LIMITS.video)).toBeNull();
    expect(mediaSizeError(video, MEDIA_LIMITS.video + 1)).toBe("视频不能超过 100MB。");
    expect(mediaSizeError(image, 0)).toBe("文件为空。");
  });

  it("only serves generated media names", () => {
    expect(isMediaFileName("0f8fad5b-d9cb-469f-a165-70867728950e.mp4")).toBe(true);
    expect(isMediaFileName("0f8fad5b-d9cb-469f-a165-70867728950e.svg")).toBe(false);
    expect(isMediaFileName("../ai-hub.sqlite")).toBe(false);
    expect(isMediaFileName("photo.png")).toBe(false);
  });
});
