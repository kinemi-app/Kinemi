// Deterministic ids for inline SVG defs (gradients, clip paths) across one build.
let n = 0;
export const uid = (prefix = 'u') => `${prefix}${(n++).toString(36)}`;
