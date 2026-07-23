export function buildEnrichedDatasets(input) {
  const characters = input.existing.characters.map((existing) => {
    const detail = input.characterDetails.get(existing.name);
    if (!detail) throw new Error(`CURRENCY_WAR_ENRICHMENT_CHARACTER_MISSING:${existing.name}`);
    return {
      ...existing,
      ...detail,
      aliases: existing.aliases ?? detail.aliases ?? [],
      advisor: input.advisors.has(existing.name),
    };
  });

  const bonds = input.existing.bonds.map((existing) => {
    const detail = input.bondDetails.get(existing.name);
    if (!detail) throw new Error(`CURRENCY_WAR_ENRICHMENT_BOND_MISSING:${existing.name}`);
    return {
      ...existing,
      ...detail,
      members: characters.filter((character) => character.bonds.includes(existing.name)).map((character) => character.name),
    };
  });

  const equipment = input.existing.equipment.map((existing) => {
    const detail = input.equipmentDetails.get(existing.name);
    if (!detail) throw new Error(`CURRENCY_WAR_ENRICHMENT_EQUIPMENT_MISSING:${existing.name}`);
    return { ...existing, ...detail };
  });

  const environments = input.existing.environments.map((existing) => {
    const detail = input.environmentDetails.get(existing.name);
    if (!detail) throw new Error(`CURRENCY_WAR_ENRICHMENT_ENVIRONMENT_MISSING:${existing.name}`);
    return { ...existing, ...detail };
  });

  return {
    characters,
    bonds,
    equipment,
    environments,
    strategies: structuredClone(input.existing.strategies),
  };
}
