export function productCliName(): "bb" | "ix" {
  const configured = process.env.BB_IX_PRODUCT_CLI?.trim().toLowerCase();
  if (configured === "ix") return "ix";
  if (configured !== undefined) return "bb";
  const base = (process.argv[1] ?? "").split(/[\\/]/u).pop() ?? "";
  return base.toLowerCase().startsWith("ix") ? "ix" : "bb";
}
