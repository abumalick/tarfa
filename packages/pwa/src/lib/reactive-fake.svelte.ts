// Tests only: a deep-reactive copy of a fake store, so a test can change what the store
// reports (a machine coming online) and see the component follow.
export function reactive<T extends object>(value: T): T {
  const state = $state(value);
  return state;
}
