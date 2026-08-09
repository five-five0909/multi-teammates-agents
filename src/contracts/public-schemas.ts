import { applySchemas } from "../control/apply-contract.js";
import { runtimeSchemas } from "../runtime/core/contracts.js";
import { hostAdapterSchemas } from "../runtime/supervisor/host-adapter.js";

export const publicSchemas = {
  ...runtimeSchemas,
  ...applySchemas,
  ...hostAdapterSchemas,
} as const;
