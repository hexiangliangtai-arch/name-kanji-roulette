import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createKanjiApiMiddleware } from "./src/server/kanjiApi";
import handleSharedResult from "./api/share";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "kanji-proxy-api",
      configureServer(server) {
        server.middlewares.use("/api/share", handleSharedResult);
        server.middlewares.use("/api/kanji", createKanjiApiMiddleware());
      },
    },
  ],
});
