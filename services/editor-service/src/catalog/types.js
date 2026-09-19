export function catalogReference({ productVersionId, manufacturerCode = null, articleNumber = null }) {
  if (!productVersionId) throw new Error("catalog_product_version_required");
  return Object.freeze({ productVersionId, manufacturerCode, articleNumber });
}

export function materialReference({ materialVersionId, legacyCode = null }) {
  if (!materialVersionId && !legacyCode) throw new Error("material_reference_required");
  return Object.freeze({ catalogMaterialVersionId: materialVersionId ?? null, legacyCode });
}
