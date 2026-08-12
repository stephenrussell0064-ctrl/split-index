/**
 * Hybrid Plan Engine — public surface.
 *
 * Consumers should import from here rather than reaching into individual
 * modules, so the internal layout stays free to change.
 *
 * Typical use:
 *   const profile = diagnose(runs, sets, oneRms, { hrMax, hrRest });   // WP0
 *   const plan = generatePlan({ state, goal, constraints, profile });  // WP3-WP7
 */

export * from "./constants";
export * from "./types";
export * from "./diagnostics";
export * from "./intake";
export * from "./safety";
export * from "./feasibility";
export * from "./macrocycle";
export * from "./prescription";
export * from "./progression";
export * from "./session-set";
export * from "./scheduler";
export * from "./event";
export * from "./engine";
export * from "./ingest";
