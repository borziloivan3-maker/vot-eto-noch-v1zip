# ВНЕЭКРАН

Imported Russian-language browser game using plain HTML, CSS, and JavaScript.
Keep the existing stack and root-level file structure.

## Run on Replit

Use Run / the **Start application** workflow, or run `python3 server.py`.
The server listens on `0.0.0.0:5000` and uses only Python's standard library.
No third-party dependencies, secrets, database, or external services are needed.
The server serves the app files and mini-game assets, not private workspace
files, and disables browser caching during development.

Game sessions are saved in the current browser's local storage.

## Imported limitation

The six `games/` pools contain no mini-game pages. The main game can load,
but mini-game-dependent gameplay requires those pages to be supplied.
See `games/README.md` for their folder structure and return URL contract.
