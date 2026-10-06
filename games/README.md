# Mini-games

Folders 1 through 6 are technical game pools assigned randomly to rooms for each new session. Add each game at games/<set>/gameNN/index.html with consecutive numbering starting at game01. The loader probes this sequence and keeps no hard-coded game list.

Each game is an independent page. The main app passes sessionId and returnUrl as query parameters. Do not pass or read player, scenario, winner, or clue details. The game's ЗАВЕРШИТЬ control should navigate to the exact returnUrl it received. No actual mini-game files are present in this project snapshot.
