import type { Provider } from "./types.js";
import { anthropic } from "./anthropic.js";
import { openai } from "./openai.js";

const PROVIDERS: Provider[] = [anthropic, openai];

export function providerForPath(pathname: string): Provider | null {
  return PROVIDERS.find((p) => p.matches(pathname)) ?? null;
}

export { anthropic, openai };
