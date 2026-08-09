import { createRequire } from "node:module";

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly engines: { readonly node: string };
}

function isPackageManifest(value: unknown): value is PackageManifest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const engines = record.engines;
  return typeof record.name === "string"
    && typeof record.version === "string"
    && typeof engines === "object"
    && engines !== null
    && typeof (engines as Record<string, unknown>).node === "string";
}

const manifest: unknown = createRequire(import.meta.url)("../package.json");
if (!isPackageManifest(manifest)) {
  throw new Error("invalid package manifest");
}

export const PACKAGE_NAME = manifest.name;
export const PACKAGE_VERSION = manifest.version;
export const NODE_VERSION_RANGE = manifest.engines.node;
