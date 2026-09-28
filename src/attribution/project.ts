import { UNALLOCATED, inferred, type Dimension } from "../domain/types.js";

export type ProjectMapping = {
  projectId: string;
  repository: string;
  pathPrefix?: string | null;
};

export function resolveProject(
  repository: Dimension<string>,
  mappings: ProjectMapping[],
): Dimension<string> {
  if (repository.confidence === "unallocated" || !repository.value) {
    return UNALLOCATED();
  }

  const repo = repository.value;
  const matches = mappings.filter((mapping) => mapping.repository === repo);

  if (matches.length === 0) return UNALLOCATED();
  if (matches.length === 1) return inferred(matches[0]!.projectId);

  const withPrefix = matches.filter((mapping) => mapping.pathPrefix);
  if (withPrefix.length === 1) return inferred(withPrefix[0]!.projectId);

  return UNALLOCATED();
}
