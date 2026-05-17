const PRICING = {
    "claude-opus-4-7": {
        inputPerMTok: 15,
        outputPerMTok: 75,
        cacheWritePerMTok: 18.75,
        cacheReadPerMTok: 1.5,
    },
    "claude-opus-4-6": {
        inputPerMTok: 15,
        outputPerMTok: 75,
        cacheWritePerMTok: 18.75,
        cacheReadPerMTok: 1.5,
    },
    "claude-sonnet-4-6": {
        inputPerMTok: 3,
        outputPerMTok: 15,
        cacheWritePerMTok: 3.75,
        cacheReadPerMTok: 0.3,
    },
    "claude-sonnet-4-5": {
        inputPerMTok: 3,
        outputPerMTok: 15,
        cacheWritePerMTok: 3.75,
        cacheReadPerMTok: 0.3,
    },
    "claude-haiku-4-5": {
        inputPerMTok: 1,
        outputPerMTok: 5,
        cacheWritePerMTok: 1.25,
        cacheReadPerMTok: 0.1,
    },
};
const DEFAULT_PRICING = PRICING["claude-sonnet-4-6"];
function lookup(model) {
    const exact = PRICING[model];
    if (exact)
        return exact;
    for (const [key, val] of Object.entries(PRICING)) {
        if (model.startsWith(key))
            return val;
    }
    const lower = model.toLowerCase();
    if (lower.includes("opus"))
        return PRICING["claude-opus-4-7"];
    if (lower.includes("haiku"))
        return PRICING["claude-haiku-4-5"];
    if (lower.includes("sonnet"))
        return PRICING["claude-sonnet-4-6"];
    return DEFAULT_PRICING;
}
export function dollarsFor(model, u) {
    const p = lookup(model);
    return ((u.inputTokens * p.inputPerMTok) / 1_000_000 +
        (u.outputTokens * p.outputPerMTok) / 1_000_000 +
        (u.cacheCreationInputTokens * p.cacheWritePerMTok) / 1_000_000 +
        (u.cacheReadInputTokens * p.cacheReadPerMTok) / 1_000_000);
}
export function emptyUsage() {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
    };
}
export function addUsage(a, b) {
    return {
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
        cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    };
}
export function isKnownModel(model) {
    if (PRICING[model])
        return true;
    for (const key of Object.keys(PRICING)) {
        if (model.startsWith(key))
            return true;
    }
    return false;
}
//# sourceMappingURL=pricing.js.map