export function undescribed(node: unknown, path: string): string[] {
  if (node === null || typeof node !== "object") return [];
  const schema = node as Record<string, unknown>;
  const properties = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  const found = Object.entries(properties ?? {}).flatMap(([name, property]) => [
    ...(typeof property.description === "string" && property.description.trim() !== ""
      ? []
      : [`${path}.${name}`]),
    ...undescribed(property, `${path}.${name}`),
  ]);
  return [
    ...found,
    ...undescribed(schema.additionalProperties, `${path}.*`),
    ...undescribed(schema.items, `${path}[]`),
    ...((schema.anyOf as unknown[] | undefined) ?? []).flatMap((item) =>
      undescribed(item, path),
    ),
  ];
}
