
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [
    react(),
    mkcert({
      hosts: ["192.168.211.157"]
    })
  ],

  server: {
    host: "0.0.0.0",
    port: 5173,

    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true
      },

      "/socket.io": {
        target: "http://127.0.0.1:5000",
        ws: true
      }
    }
  }
});
