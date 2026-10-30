// lib/ imports without extensions (Next resolves them); node needs the .ts spelled out, and the
// registry JSON needs its import attribute. Import this before a dynamic import of a lib/ module.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".")) throw error;
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          return next(specifier + suffix, context);
        } catch {
          // try the next spelling
        }
      }
      throw error;
    }
  },
  load(url, context, next) {
    return next(url, url.endsWith(".json") ? { ...context, importAttributes: { type: "json" } } : context);
  },
});
