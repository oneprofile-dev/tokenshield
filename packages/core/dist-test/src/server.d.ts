import { Server } from "node:http";
import type { ProxyConfig, RequestRecord } from "./types.js";
import { Ledger } from "./ledger.js";
export interface ProxyServerHandle {
    proxy: Server;
    dashboard: Server;
    ledger: Ledger;
    close: () => Promise<void>;
}
type DashboardRenderer = (ledger: Ledger) => string;
export interface StartOptions {
    config: ProxyConfig;
    onRecord?: (r: RequestRecord) => void;
    renderDashboard?: DashboardRenderer;
}
export declare function defaultConfig(overrides?: Partial<ProxyConfig>): ProxyConfig;
export declare function start(opts: StartOptions): Promise<ProxyServerHandle>;
export {};
