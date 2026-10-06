import { BONUSES, CLUE_LEVELS, ROOMS, SCENARIOS } from "./game-data.js";

const GAME_SET_IDS = [1, 2, 3, 4, 5, 6];

const randomIndex = (length, random = Math.random) => Math.floor(random() * length);
const choose = (items, random = Math.random) => items[randomIndex(items.length, random)];
const makeId = () => globalThis.crypto?.randomUUID?.()
  ?? `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export function selectVictim(players, random = Math.random) {
  return choose(players, random).id;
}

export function selectCulprit(players, victimId, random = Math.random) {
  return choose(players.filter((player) => player.id !== victimId), random).id;
}

export function selectScenario(random = Math.random) {
  return choose(SCENARIOS, random).id;
}

export function shuffleRoomGameSets(random = Math.random, previous = null) {
  const shuffle = () => {
    const values = [...GAME_SET_IDS];
    for (let index = values.length - 1; index > 0; index -= 1) {
      const other = randomIndex(index + 1, random);
      [values[index], values[other]] = [values[other], values[index]];
    }
    return Object.fromEntries(ROOMS.map(({ id }, index) => [id, values[index]]));
  };
  let result = shuffle();
  let attempts = 0;
  while (previous && ROOMS.every(({ id }) => previous[id] === result[id]) && attempts < 12) {
    result = shuffle();
    attempts += 1;
  }
  if (previous && ROOMS.every(({ id }) => previous[id] === result[id])) {
    [result[ROOMS[0].id], result[ROOMS[1].id]] = [result[ROOMS[1].id], result[ROOMS[0].id]];
  }
  return result;
}

export function initializeGameState(names, { random = Math.random, previousRoomGameSets = null } = {}) {
  if (!Array.isArray(names) || names.length < 4 || names.length > 6) {
    throw new Error("Для игры нужно от 4 до 6 игроков.");
  }
  const normalizedNames = names.map((name) => String(name).trim());
  if (normalizedNames.some((name) => !name)) throw new Error("Введите имя каждого игрока.");
  if (new Set(normalizedNames.map((name) => name.toLocaleLowerCase("ru"))).size !== normalizedNames.length) {
    throw new Error("Имена игроков должны различаться.");
  }

  const players = normalizedNames.map((name) => ({
    id: makeId(),
    name,
    active: true,
    cluesReceived: 0,
    wins: 0,
  }));
  const victimId = selectVictim(players, random);
  return {
    sessionId: makeId(),
    players,
    victimId,
    culpritId: selectCulprit(players, victimId, random),
    scenarioId: selectScenario(random),
    currentPlayerId: null,
    turnNumber: 0,
    eliminatedPlayers: [],
    accusationAvailable: false,
    accusationResult: null,
    usedClues: [],
    playerClues: Object.fromEntries(players.map(({ id }) => [id, []])),
    pendingMiniGame: null,
    lastCallerId: null,
    lastCalledPlayerId: null,
    roomGameSets: shuffleRoomGameSets(random, previousRoomGameSets),
    miniGamePoolsBySet: Object.fromEntries(GAME_SET_IDS.map((id) => [id, { used: [], remaining: [] }])),
    phase: "briefing",
    selectedRoomId: null,
    selectedOpponentId: null,
    accusationTargetId: null,
    lastReward: null,
    gameResult: null,
  };
}

export function createGame(names, options = {}) {
  return initializeGameState(names, options);
}

export function startTurn(gameState, random = Math.random) {
  const activePlayers = gameState.players.filter((player) => player.active);
  if (!activePlayers.length) return endGame(gameState, { reason: "no-active-players" });
  gameState.currentPlayerId = choose(activePlayers, random).id;
  gameState.turnNumber = 1;
  gameState.phase = "turn";
  gameState.selectedRoomId = null;
  gameState.selectedOpponentId = null;
  gameState.accusationAvailable = canAccuse(gameState);
  return gameState;
}

export function selectRoom(gameState, roomId) {
  if (gameState.phase !== "turn" || !ROOMS.some(({ id }) => id === roomId)) {
    throw new Error("Сейчас нельзя выбрать эту комнату.");
  }
  gameState.selectedRoomId = roomId;
  gameState.selectedOpponentId = null;
  return gameState;
}

export function selectOpponent(gameState, opponentId) {
  const caller = gameState.players.find(({ id }) => id === gameState.currentPlayerId);
  const opponent = gameState.players.find(({ id }) => id === opponentId);
  if (gameState.phase !== "turn" || !gameState.selectedRoomId || !caller?.active) {
    throw new Error("Сначала выберите комнату.");
  }
  if (!opponent?.active || opponentId === caller.id) throw new Error("Нельзя вызвать этого игрока.");
  if (gameState.lastCallerId === caller.id && gameState.lastCalledPlayerId === opponentId) {
    throw new Error("Нельзя вызывать того же соперника два хода подряд.");
  }
  const setId = gameState.roomGameSets[gameState.selectedRoomId];
  gameState.lastCallerId = caller.id;
  gameState.lastCalledPlayerId = opponentId;
  gameState.selectedOpponentId = opponentId;
  gameState.pendingMiniGame = {
    callerId: caller.id,
    opponentId,
    roomId: gameState.selectedRoomId,
    setId,
    sessionId: gameState.sessionId,
    returnUrl: null,
  };
  gameState.phase = "miniGame";
  return gameState.pendingMiniGame;
}

export function chooseMiniGame(gameState, availableGameIds, random = Math.random) {
  const pending = gameState.pendingMiniGame;
  if (gameState.phase !== "miniGame" || !pending) throw new Error("Сначала выберите комнату и соперника.");
  const gameIds = [...new Set(availableGameIds.map(String))];
  if (!gameIds.length) throw new Error(`В папке games/${pending.setId} нет доступных мини-игр.`);
  const key = String(pending.setId);
  const pools = gameState.miniGamePoolsBySet ??= Object.fromEntries(GAME_SET_IDS.map((id) => [id, { used: [], remaining: [] }]));
  const pool = pools[key] ?? { used: [], remaining: [] };
  pool.used = pool.used.filter((id) => gameIds.includes(id));
  pool.remaining = pool.remaining.filter((id) => gameIds.includes(id) && !pool.used.includes(id));
  if (pool.used.length === gameIds.length) {
    pool.used = [];
    pool.remaining = [...gameIds];
    for (let index = pool.remaining.length - 1; index > 0; index -= 1) {
      const other = randomIndex(index + 1, random);
      [pool.remaining[index], pool.remaining[other]] = [pool.remaining[other], pool.remaining[index]];
    }
  } else {
    const known = new Set([...pool.used, ...pool.remaining]);
    const added = gameIds.filter((id) => !known.has(id));
    for (let index = added.length - 1; index > 0; index -= 1) {
      const other = randomIndex(index + 1, random);
      [added[index], added[other]] = [added[other], added[index]];
    }
    pool.remaining.push(...added);
  }
  if (!pool.remaining.length) {
    pool.remaining = gameIds.filter((id) => !pool.used.includes(id));
  }
  const gameId = pool.remaining.splice(randomIndex(pool.remaining.length, random), 1)[0];
  pool.used.push(gameId);
  pools[key] = pool;
  pending.gameId = gameId;
  return gameId;
}

export function launchMiniGame(gameState, miniGameUrl, returnUrl) {
  const pending = gameState.pendingMiniGame;
  if (!pending?.gameId) throw new Error("Не выбрана мини-игра.");
  pending.returnUrl = returnUrl;
  const baseHref = globalThis.location?.href ?? "http://localhost/";
  const destination = new URL(miniGameUrl, baseHref);
  destination.searchParams.set("sessionId", gameState.sessionId);
  destination.searchParams.set("returnUrl", returnUrl);
  return destination.href;
}

export function returnFromMiniGame(gameState, sessionId) {
  if (
    gameState.phase !== "miniGame"
    || !gameState.pendingMiniGame
    || gameState.sessionId !== sessionId
    || gameState.pendingMiniGame.sessionId !== sessionId
  ) {
    throw new Error("Сессия мини-игры не совпадает с текущей партией.");
  }
  gameState.phase = "winnerPick";
  return gameState;
}

function renderClueText(template, gameState, recipientId, random) {
  const victim = gameState.players.find(({ id }) => id === gameState.victimId);
  const culprit = gameState.players.find(({ id }) => id === gameState.culpritId);
  const recipient = gameState.players.find(({ id }) => id === recipientId);
  const witnesses = gameState.players.filter(
    ({ id }) => id !== gameState.victimId && id !== gameState.culpritId,
  );
  const witness = choose(witnesses.length ? witnesses : [recipient], random);
  return template
    .replaceAll("[ЖЕРТВА]", victim.name)
    .replaceAll("[ВИНОВНИК]", culprit.name)
    .replaceAll("[ИГРОК]", recipient.name)
    .replaceAll("[СВИДЕТЕЛЬ]", witness.name);
}

function chooseClueTier(random) {
  const roll = random() * 100;
  let cumulative = 0;
  for (const level of CLUE_LEVELS) {
    cumulative += level.weight;
    if (roll < cumulative) return level.id;
  }
  return null;
}

export function giveClue(gameState, playerId, requestedLevel = null, random = Math.random) {
  const scenario = SCENARIOS.find(({ id }) => id === gameState.scenarioId);
  const desiredLevel = requestedLevel ?? chooseClueTier(random);
  if (!desiredLevel) return null;
  const availableAt = (levelId) => [
    ...scenario.clues[levelId],
    ...(levelId === "neutral" ? scenario.clues.neutralCategory ?? [] : []),
  ].filter((clue) => !gameState.usedClues.includes(`${scenario.id}:${clue.id}`));
  let level = desiredLevel;
  let pool = availableAt(level);
  if (!pool.length) {
    const desiredIndex = CLUE_LEVELS.findIndex(({ id }) => id === desiredLevel);
    const availableLevels = CLUE_LEVELS
      .map(({ id }, index) => ({ id, index, clues: availableAt(id) }))
      .filter(({ clues }) => clues.length)
      .sort((left, right) => (
        Math.abs(left.index - desiredIndex) - Math.abs(right.index - desiredIndex)
      ));
    if (!availableLevels.length) return null;
    level = choose(
      availableLevels.filter(({ index }) => Math.abs(index - desiredIndex)
        === Math.abs(availableLevels[0].index - desiredIndex)),
      random,
    ).id;
    pool = availableAt(level);
  }
  const clue = choose(pool, random);
  const record = {
    id: `${scenario.id}:${clue.id}`,
    level,
    text: renderClueText(clue.text, gameState, playerId, random),
  };
  gameState.usedClues.push(record.id);
  gameState.playerClues[playerId] ??= [];
  gameState.playerClues[playerId].push(record);
  const player = gameState.players.find(({ id }) => id === playerId);
  if (player) player.cluesReceived = gameState.playerClues[playerId].length;
  gameState.accusationAvailable = canAccuse(gameState);
  return record;
}

export function giveBonus(random = Math.random) {
  const roll = random() * 100;
  let cumulative = 0;
  for (const bonus of BONUSES) {
    cumulative += bonus.weight;
    if (roll < cumulative) return { type: "bonus", ...bonus };
  }
  return { type: "bonus", ...BONUSES[BONUSES.length - 1] };
}

export function giveReward(gameState, playerId, random = Math.random) {
  if (random() >= 0.85) {
    gameState.lastReward = { ...giveBonus(random), playerId };
  } else {
    const clue = giveClue(gameState, playerId, null, random);
    gameState.lastReward = clue
      ? { type: "clue", playerId, clue }
      : { ...giveBonus(random), playerId };
  }
  return gameState.lastReward;
}

export function resolveMiniGame(gameState, winnerId, random = Math.random) {
  if (gameState.phase !== "winnerPick" || !gameState.pendingMiniGame) {
    throw new Error("Мини-игра ещё не завершена.");
  }
  if (![gameState.pendingMiniGame.callerId, gameState.pendingMiniGame.opponentId].includes(winnerId)) {
    throw new Error("Победитель должен быть одним из участников.");
  }
  const winner = gameState.players.find(({ id }) => id === winnerId);
  winner.wins = (winner.wins ?? 0) + 1;
  giveReward(gameState, winnerId, random);
  gameState.phase = "reward";
  return gameState.lastReward;
}

export function canAccuse(gameState, playerId = gameState.currentPlayerId) {
  const player = gameState.players.find(({ id }) => id === playerId);
  return Boolean(player?.active && (gameState.playerClues[playerId]?.length ?? 0) >= 2);
}

export function startAccusation(gameState) {
  if (gameState.phase !== "turn" || !canAccuse(gameState)) {
    throw new Error("Для обвинения нужны две личные подсказки.");
  }
  gameState.phase = "accusePick";
  gameState.accusationAvailable = true;
  gameState.accusationTargetId = null;
  return gameState;
}

export function eliminatePlayer(gameState, playerId) {
  const player = gameState.players.find(({ id }) => id === playerId);
  if (player?.active) {
    player.active = false;
    if (!gameState.eliminatedPlayers.includes(playerId)) gameState.eliminatedPlayers.push(playerId);
  }
  return gameState;
}

export function endGame(gameState, result = {}) {
  gameState.gameResult = {
    ...result,
    culpritId: gameState.culpritId,
    victimId: gameState.victimId,
    scenarioId: gameState.scenarioId,
  };
  gameState.accusationAvailable = false;
  return gameState;
}

export function resolveAccusation(gameState, targetId) {
  if (gameState.phase !== "accusePick" || !canAccuse(gameState)) {
    throw new Error("Обвинение сейчас недоступно.");
  }
  const target = gameState.players.find(({ id }) => id === targetId);
  if (!target) throw new Error("Выберите игрока из этой партии.");
  const correct = targetId === gameState.culpritId;
  gameState.accusationTargetId = targetId;
  gameState.accusationResult = {
    accuserId: gameState.currentPlayerId,
    targetId,
    correct,
  };
  if (correct) {
    endGame(gameState, { winnerId: gameState.currentPlayerId, reason: "correct-accusation" });
    gameState.phase = "victory";
    return gameState;
  }
  eliminatePlayer(gameState, gameState.currentPlayerId);
  if (gameState.players.filter(({ active }) => active).length <= 1) {
    endGame(gameState, { reason: "one-player-remains" });
    gameState.phase = "finalReveal";
    return gameState;
  }
  gameState.phase = "wrongAccusation";
  gameState.accusationAvailable = false;
  return gameState;
}

export function nextTurn(gameState) {
  const activePlayers = gameState.players.filter(({ active }) => active);
  if (activePlayers.length <= 1) {
    endGame(gameState, { reason: "one-player-remains" });
    gameState.phase = "finalReveal";
    return gameState;
  }
  const currentIndex = gameState.players.findIndex(({ id }) => id === gameState.currentPlayerId);
  for (let offset = 1; offset <= gameState.players.length; offset += 1) {
    const candidate = gameState.players[(currentIndex + offset + gameState.players.length) % gameState.players.length];
    if (candidate.active) {
      gameState.currentPlayerId = candidate.id;
      break;
    }
  }
  gameState.turnNumber += 1;
  gameState.phase = "turn";
  gameState.selectedRoomId = null;
  gameState.selectedOpponentId = null;
  gameState.accusationTargetId = null;
  gameState.lastReward = null;
  gameState.pendingMiniGame = null;
  gameState.accusationAvailable = canAccuse(gameState);
  return gameState;
}
