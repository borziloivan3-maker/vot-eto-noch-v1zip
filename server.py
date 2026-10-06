"""Serve the imported browser game without exposing workspace files."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC_FILES = {
    "index.html", "styles.css", "app.js", "game-data.js",
    "game-engine.js", "storage.js",
}


class GameHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        relative = path.lstrip("/") or "index.html"
        target = (ROOT / relative).resolve()
        if not target.is_relative_to(ROOT):
            self.send_error(404)
            return None
        parts = target.relative_to(ROOT).parts
        allowed = relative in PUBLIC_FILES or (
            len(parts) > 2
            and parts[0] == "games"
            and parts[1] in {"1", "2", "3", "4", "5", "6"}
            and not any(part.startswith(".") for part in parts)
        )
        if not allowed:
            self.send_error(404)
            return None
        if target.is_dir() and not (target / "index.html").is_file():
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print("Serving ВНЕЭКРАН on 0.0.0.0:5000", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 5000), GameHandler).serve_forever()
