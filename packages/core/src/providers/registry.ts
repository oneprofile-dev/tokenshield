import type { Provider } from "./types.js";
import { anthropic } from "./anthropic.js";

const PROVIDERS: Provider[] = [anthropic];

export function providerForPath(pathname: string): Provider | null {
  return PROVIDERS.find((p) => p.matches(pathname)) ?? null;
}

export { anthropic };
