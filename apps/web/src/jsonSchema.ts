/**
 * Just enough of JSON Schema (draft 2020-12, as Zod's `toJSONSchema` writes it)
 * to generate a config form. Unknown shapes fall back to a JSON textarea.
 */
export interface JsonSchema {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema | false;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export type FieldKind = "const" | "object" | "enum" | "boolean" | "integer" | "number" | "string" | "enumArray" | "json";

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Follows local `$ref`s (`#`, `#/$defs/x`, `#/definitions/x`); sibling keywords win over the target. */
export function resolveSchema(schema: unknown, root: JsonSchema, depth = 0): JsonSchema {
  if (!isSchema(schema)) return {};
  if (!schema.$ref || depth > 16) return schema;
  const { $ref, ...rest } = schema;
  let target: unknown;
  if ($ref === "#") target = root;
  else if ($ref.startsWith("#/")) {
    target = root;
    for (const part of $ref.slice(2).split("/")) {
      const key = decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"));
      target = isSchema(target) ? (target as Record<string, unknown>)[key] : undefined;
    }
  }
  return { ...resolveSchema(target, root, depth + 1), ...rest };
}

export function schemaType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((t) => t !== "null");
  if (schema.type) return schema.type;
  if (schema.properties) return "object";
  return undefined;
}

/** Literal values a field may take, when it is a plain choice. */
export function choicesOf(schema: JsonSchema): unknown[] | null {
  if (Array.isArray(schema.enum)) return schema.enum;
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants && variants.length > 0 && variants.every((v) => isSchema(v) && v.const !== undefined)) return variants.map((v) => v.const);
  return null;
}

export function fieldKind(schema: JsonSchema, root: JsonSchema): FieldKind {
  if (schema.const !== undefined) return "const";
  if (choicesOf(schema)) return "enum";
  if (schema.anyOf || schema.oneOf) return "json";
  const type = schemaType(schema);
  switch (type) {
    case "object":
      return schema.properties ? "object" : "json";
    case "boolean":
      return "boolean";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "string":
      return "string";
    case "array": {
      if (schema.prefixItems || !schema.items) return "json";
      const items = resolveSchema(schema.items, root);
      return choicesOf(items) && schemaType(items) !== "object" ? "enumArray" : "json";
    }
    default:
      return "json";
  }
}

/** Splits a description into a short label and the rest, e.g. «Мизер: собрал линию — проиграл». */
export function labelOf(schema: JsonSchema, key: string): { label: string; hint?: string } {
  const text = (schema.title ?? schema.description ?? "").trim();
  if (!text) return { label: key };
  const cut = [". ", ": "].map((sep) => text.indexOf(sep)).filter((i) => i > 0);
  const at = cut.length > 0 ? Math.min(...cut) : -1;
  if (at > 0 && at <= 70) {
    const hint = text.slice(at + 2).trim();
    return { label: text.slice(0, at), hint: hint || undefined };
  }
  if (text.length <= 70) return { label: text };
  return { label: key, hint: text };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copy of `obj` with `key` set, or removed when `value` is undefined. */
export function withKey(obj: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** One line for short values, indented otherwise. */
export function formatJson(value: unknown): string {
  if (value === undefined) return "";
  const compact = JSON.stringify(value);
  return compact.length <= 60 ? compact : JSON.stringify(value, null, 2);
}
