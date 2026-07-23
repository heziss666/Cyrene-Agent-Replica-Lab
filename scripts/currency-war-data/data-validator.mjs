export function validateEnrichedData(datasets) {
  const errors = [];
  const warnings = [];
  const characters = datasets.characters ?? [];
  const bonds = datasets.bonds ?? [];
  const equipment = datasets.equipment ?? [];
  const environments = datasets.environments ?? [];
  const strategies = datasets.strategies ?? [];
  const bondByName = new Map(bonds.map((item) => [item.name, item]));
  const characterByName = new Map(characters.map((item) => [item.name, item]));
  const equipmentNames = new Set(equipment.map((item) => item.name));

  checkUnique(characters, "CHARACTER", errors);
  checkUnique(bonds, "BOND", errors);
  checkUnique(equipment, "EQUIPMENT", errors);
  checkUnique(environments, "ENVIRONMENT", errors);
  checkUnique(strategies, "STRATEGY", errors);

  for (const character of characters) {
    if (character.field.includes("前") && !character.empowerment?.front) {
      errors.push(`CHARACTER_FRONT_EMPOWERMENT_MISSING:${character.name}`);
    }
    if (character.field.includes("后") && !character.empowerment?.back) {
      errors.push(`CHARACTER_BACK_EMPOWERMENT_MISSING:${character.name}`);
    }
    if (Object.keys(character.empowerment?.stars ?? {}).length === 0) {
      errors.push(`CHARACTER_STARS_MISSING:${character.name}`);
    }
    for (const bondName of character.bonds ?? []) {
      const bond = bondByName.get(bondName);
      if (!bond) errors.push(`CHARACTER_BOND_UNKNOWN:${character.name}:${bondName}`);
      else if (!bond.members.includes(character.name)) errors.push(`BOND_MEMBER_MISMATCH:${character.name}:${bondName}`);
    }
    for (const equipmentName of character.recommended_equipment ?? []) {
      if (!equipmentNames.has(equipmentName)) {
        errors.push(`CHARACTER_EQUIPMENT_UNKNOWN:${character.name}:${equipmentName}`);
      }
    }
  }

  for (const bond of bonds) {
    if (Object.keys(bond.effects ?? {}).length === 0) errors.push(`BOND_EFFECTS_MISSING:${bond.name}`);
    for (const member of bond.members ?? []) {
      const character = characterByName.get(member);
      if (!character) errors.push(`BOND_CHARACTER_UNKNOWN:${bond.name}:${member}`);
      else if (!character.bonds.includes(bond.name)) errors.push(`BOND_CHARACTER_MISMATCH:${bond.name}:${member}`);
    }
  }

  for (const item of equipment) {
    for (const material of item.recipe ?? []) {
      if (!equipmentNames.has(material)) warnings.push(`EQUIPMENT_RECIPE_MATERIAL_UNKNOWN:${item.name}:${material}`);
    }
  }
  for (const environment of environments) {
    if (!environment.effect) warnings.push(`ENVIRONMENT_EFFECT_MISSING:${environment.name}`);
  }

  return {
    errors,
    warnings,
    metrics: {
      characters: characters.length,
      bonds: bonds.length,
      equipment: equipment.length,
      environments: environments.length,
      strategies: strategies.length,
    },
  };
}

function checkUnique(records, label, errors) {
  const names = new Set();
  for (const record of records) {
    if (names.has(record.name)) errors.push(`${label}_DUPLICATE:${record.name}`);
    names.add(record.name);
  }
}
