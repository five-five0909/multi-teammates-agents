import { ContractError, type WorkItem } from "./contracts.js";

export function normalizeScope(scope: string): string[] {
  const normalized = scope.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "").toLocaleLowerCase("en-US");
  if (normalized.length === 0) {
    throw new ContractError("ownership scopes must not be empty");
  }
  const parts = normalized.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.includes("..")) {
    throw new ContractError(`ownership scope escapes its root: ${scope}`);
  }
  return parts;
}

export function scopesOverlap(left: string, right: string): boolean {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  const prefixLength = Math.min(a.length, b.length);
  return a.slice(0, prefixLength).every((part, index) => part === b[index]);
}

export function validateWorkGraph(items: Iterable<WorkItem>): Record<string, WorkItem> {
  const byId: Record<string, WorkItem> = {};
  for (const item of items) {
    if (item.id in byId) {
      throw new ContractError(`duplicate work item id: ${item.id}`);
    }
    byId[item.id] = item;
  }
  if (Object.keys(byId).length === 0) {
    throw new ContractError("managed run requires at least one work item");
  }
  for (const item of Object.values(byId)) {
    if (item.depends_on.includes(item.id)) {
      throw new ContractError(`${item.id}: self dependency`);
    }
    for (const dependency of item.depends_on) {
      if (!(dependency in byId)) {
        throw new ContractError(`${item.id}: unknown dependency ${dependency}`);
      }
    }
    item.ownership.forEach(normalizeScope);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ContractError(`dependency cycle contains ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId[id]?.depends_on ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  Object.keys(byId).forEach(visit);
  return byId;
}

export function validateParallelWave(items: Iterable<WorkItem>): void {
  const writers = Array.from(items).filter((item) => item.mode === "write");
  for (let leftIndex = 0; leftIndex < writers.length; leftIndex += 1) {
    const left = writers[leftIndex];
    if (left === undefined) continue;
    for (const right of writers.slice(leftIndex + 1)) {
      if (left.ownership.some((a) => right.ownership.some((b) => scopesOverlap(a, b)))) {
        throw new ContractError(`write ownership overlaps between ${left.id} and ${right.id}`);
      }
    }
  }
}
