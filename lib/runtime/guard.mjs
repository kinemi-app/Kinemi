/**
 * The hardware floors the full Comfy stack needs, as plain JavaScript on purpose: `scripts/start.mjs`
 * runs under bare `node`, and importing a `.ts` module there needs Node 22.18 or a loader, while the
 * README promises Node 20.9. Keep this file dependency-free and free of TypeScript syntax.
 */

/**
 * @typedef {{ ramGb: number, vramGb?: number, diskGb: number }} MachineResources
 * @typedef {{ ramGb: number, vramGb: number, diskGb: number }} HardwareFloors
 */

const ASK_THE_USER = "Ask the user before raising the floors or starting the full stack.";

/**
 * @param {number} value
 * @returns {string}
 */
function formatGb(value) {
  return `${Number(value.toFixed(2))} GB`;
}

/**
 * @param {string} name
 * @param {number} availableGb
 * @param {number} floorGb
 * @returns {string}
 */
function shortfall(name, availableGb, floorGb) {
  return `${name} ${formatGb(availableGb)} (needs ${formatGb(floorGb)})`;
}

/**
 * Compare what the machine has with the floors the full Comfy stack needs. Returns null when every
 * floor is met, otherwise one line that names each shortfall and ends with the question an agent
 * must put to its user before overriding a floor.
 *
 * @param {MachineResources} resources
 * @param {HardwareFloors} floors
 * @returns {string | null}
 */
export function checkHardware(resources, floors) {
  /** @type {string[]} */
  const problems = [];

  if (resources.ramGb < floors.ramGb) {
    problems.push(shortfall("RAM", resources.ramGb, floors.ramGb));
  }
  if (resources.vramGb !== undefined && resources.vramGb < floors.vramGb) {
    problems.push(shortfall("VRAM", resources.vramGb, floors.vramGb));
  }
  if (resources.diskGb < floors.diskGb) {
    problems.push(shortfall("free disk", resources.diskGb, floors.diskGb));
  }

  if (problems.length === 0) {
    return null;
  }
  return `The machine is below the full-stack floors: ${problems.join("; ")}. ${ASK_THE_USER}`;
}
