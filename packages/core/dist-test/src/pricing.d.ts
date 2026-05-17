import type { ModelId, UsageCounts } from "./types.js";
export declare function dollarsFor(model: ModelId, u: UsageCounts): number;
export declare function emptyUsage(): UsageCounts;
export declare function addUsage(a: UsageCounts, b: UsageCounts): UsageCounts;
export declare function isKnownModel(model: ModelId): boolean;
