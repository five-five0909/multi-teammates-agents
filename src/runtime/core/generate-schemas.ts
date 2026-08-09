import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { publicSchemas } from "../../contracts/public-schemas.js";

const target = resolve("schemas", "mta", "v1");
await mkdir(target, { recursive: true });
for (const [name, schema] of Object.entries(publicSchemas)) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" });
  await writeFile(resolve(target, `${name}.schema.json`), `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
}
