import { c, sym, say, dim, emit } from "../lib/ui.js";
import { fetchRemoteLicense, writeLicense, readLicense, deleteLicense } from "../lib/license.js";
import { TokenShieldError } from "../lib/errors.js";

export interface LoginOptions {
  token?: string;
}

const CONNECT_URL = "https://www.curatedmcp.com/tokenshield/connect";
const UPGRADE_URL = "https://www.curatedmcp.com/tokenshield/upgrade";

export async function runLogin(options: LoginOptions): Promise<void> {
  if (!options.token) {
    throw new TokenShieldError({
      code: "MISSING_TOKEN",
      message: "Pass your license token with --token.",
      nextSteps: [
        `1. Subscribe at ${UPGRADE_URL}`,
        `2. Copy your license token from ${CONNECT_URL}`,
        `3. Run: tokenshield login --token <paste-here>`,
      ],
    });
  }

  say("");
  say(`${sym.arrow} Validating token with curatedmcp.com…`);

  const remote = await fetchRemoteLicense(options.token.trim());

  writeLicense({
    token: options.token.trim(),
    tier: remote.tier,
    status: remote.status,
    enabledProcessors: remote.enabledProcessors,
    email: remote.email,
    fetchedAt: new Date().toISOString(),
  });

  emit("");
  emit(`${sym.check} ${c.bold("Logged in as")} ${remote.email}`);
  emit(`  Tier:     ${c.brightGreen(remote.tier.toUpperCase())} (${remote.status})`);
  emit(`  Processors: ${remote.enabledProcessors.length === 0 ? dim("none active") : remote.enabledProcessors.join(", ")}`);
  emit("");
  emit(dim("On next `tokenshield up`, the dashboard pill flips from Estimate mode → Pro · active."));
  emit("");
}

export async function runLogout(): Promise<void> {
  const existing = readLicense();
  if (!existing) {
    say(`${sym.info} No license stored on this machine — nothing to log out of.`);
    return;
  }
  deleteLicense();
  emit("");
  emit(`${sym.check} ${c.bold("Logged out.")} License token removed from ~/.tokenshield/license.json`);
  emit(dim("  You can re-link any time at " + CONNECT_URL));
  emit("");
}

export async function runWhoami(): Promise<void> {
  const license = readLicense();
  if (!license) {
    say("");
    say(`${sym.info} Not logged in. Free CLI tier is active.`);
    say("");
    say(`  ${c.bold("To upgrade:")} ${UPGRADE_URL}`);
    say(`  ${c.bold("To link an existing license:")} tokenshield login --token <your-token>`);
    say("");
    return;
  }

  // Refresh from server so we report current truth, not stale cache
  try {
    const remote = await fetchRemoteLicense(license.token);
    writeLicense({
      token: license.token,
      tier: remote.tier,
      status: remote.status,
      enabledProcessors: remote.enabledProcessors,
      email: remote.email,
      fetchedAt: new Date().toISOString(),
    });
    emit("");
    emit(`${sym.check} ${c.bold("Logged in as")} ${remote.email}`);
    emit(`  Tier:       ${c.brightGreen(remote.tier.toUpperCase())} (${remote.status})`);
    emit(`  Processors: ${remote.enabledProcessors.length === 0 ? dim("none active") : remote.enabledProcessors.join(", ")}`);
    if (remote.currentPeriodEnd) {
      emit(`  Renews:     ${dim(new Date(remote.currentPeriodEnd).toLocaleDateString())}`);
    }
    emit("");
  } catch (err) {
    // Network error or revocation — show cached state but flag staleness
    emit("");
    emit(`${sym.warn} Could not refresh from curatedmcp.com (${(err as Error).message})`);
    emit(`  Showing cached license from ${dim(new Date(license.fetchedAt).toLocaleString())}:`);
    emit(`  Email:      ${license.email ?? dim("unknown")}`);
    emit(`  Tier:       ${license.tier.toUpperCase()} (${license.status})`);
    emit(`  Processors: ${license.enabledProcessors.length === 0 ? dim("none active") : license.enabledProcessors.join(", ")}`);
    emit("");
  }
}
