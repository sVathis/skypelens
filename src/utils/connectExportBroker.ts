import { createExportBrokerClient, type ExportBroker } from "./exportBroker";

/**
 * Connects this tab to the SharedWorker that links SkypeLens tabs privately. Returns
 * null where SharedWorker isn't available (e.g. some mobile browsers); tabs then only
 * hand links over to each other, without copying exports.
 */
export function connectExportBroker(tabId: string): ExportBroker | null {
  if (typeof SharedWorker === "undefined") return null;
  try {
    const worker = new SharedWorker(
      new URL("../workers/exportBroker.worker.ts", import.meta.url),
      { type: "module", name: "skypelens-export-broker" },
    );
    return createExportBrokerClient(worker.port, tabId);
  } catch {
    return null;
  }
}
