import { defineConfig } from "vite";
import { readFileSync } from "fs";

const ALLOWED_STATIC = [
  "author/players.json",
  "author/players/1.jpg",
  "author/players/2.jpg",
  "author/players/3.jpg",
  "author/players/4.jpg",
  "author/players/5.jpg",
  "author/players/6.jpg",
];
for (let s = 1; s <= 5; s++) {
  for (let v = 1; v <= 6; v++) {
    ALLOWED_STATIC.push(`author/cases/S${String(s).padStart(2, "0")}/start-${v}.jpg`);
  }
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function staticPlugin() {
  return {
    name: "serve-static-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent(req.url || "/").split("?")[0].replace(/^\/+/, "");
        const rel = path || "index.html";
        if (ALLOWED_STATIC.includes(rel)) {
          try {
            const data = readFileSync(rel);
            const ext = "." + rel.split(".").pop();
            res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
            res.end(data);
            return;
          } catch {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
        }
        if (rel.startsWith("games/") && !rel.includes("/.")) {
          try {
            const data = readFileSync(rel);
            const ext = "." + rel.split(".").pop();
            res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
            res.end(data);
            return;
          } catch {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [staticPlugin()],
  server: {
    host: true,
    port: 5173,
  },
});
