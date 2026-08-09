const secretKey = /^(?:api[_ -]?key|auth(?:orization)?|access[_ -]?token|token|password|secret)$/iu;
const labelledSecret = /(api[_-]?key|auth(?:orization)?|access[_-]?token|password|secret)(\s*[=:]\s*)([^\s,;]+)/giu;
const bearer = /\bbearer\s+[a-z0-9._~+/=-]+/giu;
const openAiKey = /\bsk-[a-zA-Z0-9_-]{8,}\b/gu;

export function redactSecrets(value: string): string {
  return value
    .replace(labelledSecret, "$1$2***REDACTED***")
    .replace(bearer, "Bearer ***REDACTED***")
    .replace(openAiKey, "sk-***REDACTED***");
}

export function redactValue(value: unknown, field?: string): unknown {
  if (field !== undefined && secretKey.test(field)) return "***REDACTED***";
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, key)]));
  }
  return value;
}
