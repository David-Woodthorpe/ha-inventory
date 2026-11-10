import { locationTree } from '$lib/server/locations';

export function load() {
  return { tree: locationTree() };
}
