import { defineConfig } from "vite";

// GitHub Pages では https://<owner>.github.io/<repo>/ 配下になるため base を環境変数で切り替える
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
});
