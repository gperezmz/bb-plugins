// Emits schema/onboarding.schema.json from the zod schema. Run with
// `npm run schema`; a test fails when the committed file is stale.
import { writeFileSync } from "node:fs";
import { manifestJsonSchema } from "../src/core/manifest.ts";

const schema = {
  $id: "https://raw.githubusercontent.com/gperezmz/bb-plugins/main/plugins/team-onboarding/schema/onboarding.schema.json",
  title: "Team Onboarding manifest",
  ...(manifestJsonSchema() as Record<string, unknown>),
};
writeFileSync(new URL("../schema/onboarding.schema.json", import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
console.log("wrote schema/onboarding.schema.json");
