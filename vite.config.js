import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: "es2022", // needed for top-level await used in src/main.js and src/list.js
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        race: resolve(__dirname, "race.html"),
      },
    },
  },
});
