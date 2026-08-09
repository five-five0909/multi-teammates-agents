import { ContractError, decodeContract, runEventSchema, type RunEvent } from "./contracts.js";

export function encodeEvent(event: RunEvent): string {
  return JSON.stringify(event);
}

export function decodeEvent(line: string, lineNumber?: number): RunEvent {
  const label = lineNumber === undefined ? "event" : `event line ${lineNumber}`;
  if (line.trim().length === 0) {
    throw new ContractError(`${label} is empty`);
  }
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch (error) {
    throw new ContractError(`${label} is invalid JSON`, { cause: error });
  }
  return decodeContract(runEventSchema, value, label);
}

export function decodeEvents(lines: Iterable<string>): RunEvent[] {
  return Array.from(lines, (line, index) => decodeEvent(line, index + 1));
}
