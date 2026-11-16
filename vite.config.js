import { readFileSync, utimesSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const REMOTE_IMPORT = /@import\s+(?:url\(\s*)?(["'])https?:\/\/.*?\1[^;]*;/g;
const LOCAL_IMPORT = /@import\s+["'](\.{1,2}\/[^"']+\.css)["'][^;]*;/g;

// Fonction chargée de hisser les imports externes (merci Claude)
// Tailwind inline les @import locaux : les @import distants (ex. polices) des thèmes
// se retrouveraient après d'autres règles, ce qui est invalide.
// On inline donc les thèmes nous-mêmes, avant Tailwind, en remontant les @import distants en tête.
const inlineThemesWithHoistedRemoteImports = () => {
  // fichier de thème -> feuilles racines qui l'inlinent
  const rootsByDependency = new Map();

  return {
    name: "inline-themes-hoist-remote-imports",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".css") || !LOCAL_IMPORT.test(code)) return null;
      LOCAL_IMPORT.lastIndex = 0;

      const remote = [];
      const inline = (source, from) =>
        source.replace(LOCAL_IMPORT, (_, path) => {
          const target = resolve(dirname(from), path);
          this.addWatchFile(target);
          if (!rootsByDependency.has(target))
            rootsByDependency.set(target, new Set());
          rootsByDependency.get(target).add(file);
          const content = readFileSync(target, "utf8").replace(
            REMOTE_IMPORT,
            (m) => {
              remote.push(m);
              return "";
            },
          );
          return inline(content, target);
        });

      const body = inline(code, file);
      const head = code.match(REMOTE_IMPORT) ?? [];
      const lead = [...new Set([...head, ...remote])].join("\n");
      return {
        code: (lead ? lead + "\n" : "") + body.replace(REMOTE_IMPORT, ""),
        map: null,
      };
    },
    // En dev, Tailwind met en cache le compilateur de la feuille racine et ne le reconstruit
    // que si SES dépendances changent (il ignore les thèmes, déjà inlinés) : on "touche"
    // la feuille racine pour forcer la reconstruction, puis on l'invalide dans le graphe.
    hotUpdate({ file, modules }) {
      const roots = rootsByDependency.get(file);
      if (!roots) return;
      const affected = new Set(modules);
      for (const root of roots) {
        const now = new Date();
        utimesSync(root, now, now);
        for (const mod of this.environment.moduleGraph.getModulesByFile(root) ??
          []) {
          this.environment.moduleGraph.invalidateModule(mod);
          affected.add(mod);
        }
      }
      return [...affected];
    },
  };
};

export default defineConfig({
  plugins: [inlineThemesWithHoistedRemoteImports(), tailwindcss()],
});
