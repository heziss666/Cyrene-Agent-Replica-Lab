export type StandardNodeType = "reward" | "combat" | "supply" | "encounter" | "boss";
export type StandardTransitionEvent = `investment_strategy:${1 | 2 | 3}`;

export interface StandardNode {
  id: string;
  plane: 1 | 2 | 3;
  index: number;
  type: StandardNodeType;
}

const FIRST_PLANE_TYPES: readonly StandardNodeType[] = [
  "reward", "reward", "combat", "combat", "supply", "combat", "encounter", "reward", "boss",
];
const LATER_PLANE_TYPES: readonly StandardNodeType[] = [
  "combat", "combat", "supply", "combat", "encounter", "reward", "boss",
];

const standardNodes = createStandardNodes();

export function getStandardNode(nodeId: string): StandardNode {
  const node = standardNodes.get(nodeId);
  if (!node) throw new Error("CURRENCY_WAR_STANDARD_NODE_UNKNOWN");
  return { ...node };
}

export function getStandardTransition(nodeId: string): {
  nextNodeId: string | undefined;
  eventsBeforeNextNode: StandardTransitionEvent[];
} {
  const node = getStandardNode(nodeId);
  const nextNodeId = standardNodes.has(`${node.plane}-${node.index + 1}`)
    ? `${node.plane}-${node.index + 1}`
    : node.type === "boss" && node.plane < 3 ? `${node.plane + 1}-1` : undefined;
  return {
    nextNodeId,
    eventsBeforeNextNode: nodeId === "1-2" ? ["investment_strategy:1"]
      : nodeId === "2-1" ? ["investment_strategy:2"]
        : nodeId === "3-1" ? ["investment_strategy:3"] : [],
  };
}

function createStandardNodes(): Map<string, StandardNode> {
  const nodes = new Map<string, StandardNode>();
  for (const [plane, types] of [[1, FIRST_PLANE_TYPES], [2, LATER_PLANE_TYPES], [3, LATER_PLANE_TYPES]] as const) {
    types.forEach((type, offset) => {
      const index = offset + 1;
      const id = `${plane}-${index}`;
      nodes.set(id, { id, plane, index, type });
    });
  }
  return nodes;
}
