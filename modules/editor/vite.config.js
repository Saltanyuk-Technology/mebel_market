import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const editorDirectory = fileURLToPath(new URL(".", import.meta.url));

export default {
  base: "/editor/",
  resolve: {
    alias: [
      {
        find: /^three\/addons/,
        replacement: resolve(editorDirectory, "../constructor/node_modules/three/examples/jsm"),
      },
      {
        find: /^three$/,
        replacement: resolve(editorDirectory, "../constructor/node_modules/three/build/three.module.js"),
      },
    ],
  },
};
