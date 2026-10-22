// Tests the release helpers: semantic version order, picking the latest release,
// parsing the release index, release-state resolution, and the review diff between an
// approved version and a candidate (requests and files).
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  diffReleases,
  latestRelease,
  parseReleases,
  resolveReleaseState,
} from "~/lib/plugins";
import { fakeSha, makeRelease } from "./releaseFixtures";

const approvalOf = (release = makeRelease()) => ({
  pluginId: release.id,
  version: release.version,
  digest: release.digest,
  files: release.files,
  requests: release.requests,
  releaseNotes: release.releaseNotes,
  source: release.source,
  approvedAt: "2026-10-15T00:00:00.000Z",
});

describe("compareVersions", () => {
  it.each([
    ["1.0.0", "1.0.1", -1],
    ["1.10.0", "1.9.0", 1],
    ["2.0.0", "2.0.0", 0],
    ["1.0.0-beta.1", "1.0.0", -1],
    ["1.0.0-beta.2", "1.0.0-beta.10", -1],
  ])("orders %s and %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });

  it("picks the latest release", () => {
    const releases = ["1.2.0", "1.10.0", "1.9.3"].map((version) =>
      makeRelease({ version }),
    );
    expect(latestRelease(releases)?.version).toBe("1.10.0");
    expect(latestRelease([])).toBeUndefined();
  });
});

describe("parseReleases", () => {
  it("keeps valid releases and drops invalid ones", () => {
    const valid = makeRelease();
    expect(
      parseReleases([valid, { ...valid, digest: "md5:x" }, { id: "x" }, "nope"]),
    ).toEqual([valid]);
    expect(parseReleases({ releases: [] })).toEqual([]);
  });
});

describe("resolveReleaseState", () => {
  it("covers each state", () => {
    const v1 = makeRelease();
    const v2 = makeRelease({ version: "1.1.0" });
    expect(resolveReleaseState(undefined, [])).toEqual({ kind: "no-release" });
    expect(resolveReleaseState(undefined, [v1, v2]).kind).toBe("not-approved");
    expect(resolveReleaseState(approvalOf(v1), [v1]).kind).toBe("approved");
    expect(resolveReleaseState(approvalOf(v1), [v1, v2]).kind).toBe("update-available");
    expect(
      resolveReleaseState(approvalOf(v1), [
        { ...v1, digest: `sha256:${"f".repeat(64)}` },
      ]).kind,
    ).toBe("changed");
    expect(resolveReleaseState(approvalOf(v1), [v2]).kind).toBe("missing");
  });
});

describe("diffReleases", () => {
  it("lists request and file changes", () => {
    const from = makeRelease();
    const to = makeRelease({
      version: "1.1.0",
      requests: {
        network: ["https://data.example.com"],
        storage: false,
        downloads: true,
        popups: false,
      },
      files: {
        "index.html": { sha256: fakeSha("index"), bytes: 400 }, // unchanged
        "assets/app.js": { sha256: fakeSha("app-new"), bytes: 4096 }, // changed
        "assets/export.js": { sha256: fakeSha("export"), bytes: 512 }, // added
      },
    });
    const fromWithOld = {
      ...from,
      files: {
        ...from.files,
        "assets/legacy.js": { sha256: fakeSha("old"), bytes: 10 },
      },
    };

    expect(diffReleases(fromWithOld, to)).toEqual({
      requests: {
        added: ["Network access to https://data.example.com", "Downloading files"],
        removed: [],
        declaredBefore: true,
        declaredNow: true,
      },
      files: {
        added: [{ path: "assets/export.js", bytes: 512 }],
        removed: [{ path: "assets/legacy.js", bytes: 10 }],
        changed: [{ path: "assets/app.js", fromBytes: 2048, toBytes: 4096 }],
      },
    });
  });

  it("reports nothing for identical releases", () => {
    const release = makeRelease();
    const diff = diffReleases(release, release);
    expect(diff.requests.added).toEqual([]);
    expect(diff.files).toEqual({ added: [], removed: [], changed: [] });
  });
});
