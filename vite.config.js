import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      {
        name: "boe-flow-api-url",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            return html.replaceAll("%VITE_API_URL%", env.VITE_API_URL || "");
          },
        },
      },
    ],
    server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
  };
});
