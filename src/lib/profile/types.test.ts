import { describe, expect, it } from "vitest";
import { zodSchema } from "ai";
import { candidateProfileSchema } from "./types";

/** Groq structured outputs reject schemas where any property is missing from `required`. */
function assertAllPropertiesRequired(schema: unknown, path = "root"): void {
  if (!schema || typeof schema !== "object") return;
  const node = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
  };
  if (node.type === "object" && node.properties) {
    const required = new Set(node.required ?? []);
    for (const key of Object.keys(node.properties)) {
      expect(required.has(key), `${path}.${key} must be in required`).toBe(true);
      assertAllPropertiesRequired(node.properties[key], `${path}.${key}`);
    }
  }
  if (node.items) assertAllPropertiesRequired(node.items, `${path}[]`);
}

describe("candidateProfileSchema (Groq structured output)", () => {
  it("lists every property in required at every object level", async () => {
    const jsonSchema = await zodSchema(candidateProfileSchema).jsonSchema;
    assertAllPropertiesRequired(jsonSchema);
  });
});
