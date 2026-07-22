import type { CurrencyWarBond, CurrencyWarCharacter } from "../data/currency-war-data-types.js";

export interface BondAnalysis {
  name: string;
  activeMembers: number;
  activeTiers: number[];
  nextTier: number | undefined;
  membersNeeded: number | undefined;
}

export function analyzeBonds(boardCharacterNames: readonly string[], characters: readonly CurrencyWarCharacter[], bonds: readonly CurrencyWarBond[]): BondAnalysis[] {
  const boardNames = new Set(boardCharacterNames);
  const characterBonds = new Map(characters.map((character) => [character.name, character.bonds]));
  return bonds.map((bond) => {
    const activeMembers = bond.members.filter((name) => boardNames.has(name) && characterBonds.get(name)?.includes(bond.name)).length;
    const tiers = Object.keys(bond.effects).map(Number).filter(Number.isInteger).sort((left, right) => left - right);
    const activeTiers = tiers.filter((tier) => tier <= activeMembers);
    const nextTier = tiers.find((tier) => tier > activeMembers);
    return { name: bond.name, activeMembers, activeTiers, nextTier, membersNeeded: nextTier === undefined ? undefined : nextTier - activeMembers };
  });
}
