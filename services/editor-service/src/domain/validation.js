import { DOCUMENT_SCHEMA_VERSION, ENTITY_COLLECTIONS } from "./document.js";

function violation(code, entityIds = [], parameters = {}) {
  return { ruleId: `core.${code.toLowerCase().replaceAll("_", "-")}`, code, severity: "error", entityIds, parameters };
}

function findAssemblyCycles(assemblies, byId) {
  const cyclic = new Set();
  assemblies.forEach((assembly) => {
    const path = [];
    const positions = new Map();
    let current = assembly;
    while (current) {
      if (positions.has(current.id)) {
        path.slice(positions.get(current.id)).forEach((id) => cyclic.add(id));
        break;
      }
      positions.set(current.id, path.length);
      path.push(current.id);
      current = current.parentAssemblyId ? byId.get(current.parentAssemblyId) : null;
    }
  });
  return [...cyclic].sort();
}

export function validateFurnitureDocument(document) {
  const violations = [];
  if (!document || document.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    return { valid: false, violations: [violation("INVALID_SCHEMA_VERSION")] };
  }
  if (document.documentType !== "furniture-definition" || !document.entities) {
    return { valid: false, violations: [violation("INVALID_DOCUMENT_TYPE")] };
  }

  const collections = ENTITY_COLLECTIONS.map((name) => (
    Array.isArray(document.entities[name]) ? document.entities[name] : []
  ));
  const allEntities = collections.flat();
  const seenIds = new Set();
  allEntities.forEach((entity) => {
    if (!entity?.id) {
      violations.push(violation("MISSING_ENTITY_ID"));
    } else if (seenIds.has(entity.id)) {
      violations.push(violation("DUPLICATE_ENTITY_ID", [entity.id]));
    } else {
      seenIds.add(entity.id);
    }
  });

  const assemblies = Array.isArray(document.entities.assemblies) ? document.entities.assemblies : [];
  const assemblyById = new Map(assemblies.map((assembly) => [assembly.id, assembly]));
  const roots = assemblies.filter((assembly) => assembly.parentAssemblyId == null);
  if (roots.length === 0) violations.push(violation("MISSING_ROOT_ASSEMBLY"));
  if (roots.length > 1) violations.push(violation("MULTIPLE_ROOT_ASSEMBLIES", roots.map((item) => item.id)));
  if (!assemblyById.has(document.rootAssemblyId)) {
    violations.push(violation("ROOT_ASSEMBLY_NOT_FOUND", [document.rootAssemblyId].filter(Boolean)));
  }
  if (roots.length === 1 && roots[0].id !== document.rootAssemblyId) {
    violations.push(violation("ROOT_ASSEMBLY_MISMATCH", [roots[0].id, document.rootAssemblyId].filter(Boolean)));
  }

  assemblies.forEach((assembly) => {
    if (assembly.parentAssemblyId && !assemblyById.has(assembly.parentAssemblyId)) {
      violations.push(violation("ORPHAN_ASSEMBLY", [assembly.id], { parentAssemblyId: assembly.parentAssemblyId }));
    }
  });
  const cyclicIds = findAssemblyCycles(assemblies, assemblyById);
  if (cyclicIds.length) violations.push(violation("ASSEMBLY_CYCLE", cyclicIds));

  for (const collectionName of ["panels", "facades", "hardwareInstances"]) {
    const entities = Array.isArray(document.entities[collectionName]) ? document.entities[collectionName] : [];
    entities.forEach((entity) => {
      if (!assemblyById.has(entity.ownerAssemblyId)) {
        violations.push(violation("ORPHAN_ENTITY", [entity.id].filter(Boolean), {
          collection: collectionName,
          ownerAssemblyId: entity.ownerAssemblyId ?? null,
        }));
      }
    });
  }

  return { valid: violations.length === 0, violations };
}
