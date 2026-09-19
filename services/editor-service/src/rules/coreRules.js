import { validateFurnitureDocument } from "../domain/validation.js";

export function createCoreRules() {
  return [
    {
      id: "core.document-structure",
      evaluate: ({ document }) => validateFurnitureDocument(document).violations,
    },
    {
      id: "core.panel-dimensions",
      evaluate: ({ document }) => (document.entities?.panels ?? []).flatMap((panel) => {
        const dimensions = panel.dimensionsMm ?? {};
        return [dimensions.x, dimensions.y, dimensions.z].every((value) => Number.isFinite(value) && value > 0)
          ? []
          : [{ code: "INVALID_PANEL_DIMENSIONS", entityIds: [panel.id] }];
      }),
    },
    {
      id: "core.material-reference",
      evaluate: ({ document }) => (document.entities?.panels ?? [])
        .filter((panel) => !panel.materialRef?.catalogMaterialVersionId && !panel.materialRef?.legacyCode)
        .map((panel) => ({ code: "MATERIAL_REFERENCE_REQUIRED", severity: "warning", entityIds: [panel.id] })),
    },
    {
      id: "core.hardware-catalog-version",
      evaluate: ({ document }) => (document.entities?.hardwareInstances ?? [])
        .filter((hardware) => !hardware.catalogProductVersionId && !hardware.legacyData)
        .map((hardware) => ({ code: "HARDWARE_VERSION_REQUIRED", severity: "warning", entityIds: [hardware.id] })),
    },
  ];
}
