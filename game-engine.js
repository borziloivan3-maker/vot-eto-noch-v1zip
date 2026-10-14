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

export function initializeGameState(roster, { random = Math.random, previousRoomGameSets = null } = {}) {
  if (!Array.isArray(roster) || roster.length < 4 || roster.length > 6) {
    throw new Error("Для игры нужно от 4 до 6 игроков.");
  }
  const normalizedRoster = roster.map((entry, index) => {
    const profile = typeof entry === "string"
      ? { id: String(index + 1), name: entry }
      : entry;
    if (!profile || typeof profile !== "object") {
      throw new Error("Проверьте состав игроков.");
    }
    return {
      id: String(profile.id ?? index + 1),
      name: String(profile.name ?? "").trim(),
      avatar: typeof profile.avatar === "string" && profile.avatar ? profile.avatar : null,
    };
  });
  if (normalizedRoster.some(({ name }) => !name)) throw new Error("Введите имя каждого игрока.");
  if (new Set(normalizedRoster.map(({ name }) => name.toLocaleLowerCase("ru"))).size !== normalizedRoster.length) {
    throw new Error("Имена игроков должны различаться.");
  }
  if (new Set(normalizedRoster.map(({ id }) => id)).size !== normalizedRoster.length) {
    throw new Error("ID игроков должны различаться.");
  }

  const players = normalizedRoster.map((profile) => ({
    ...profile,
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

export function createGame(roster, options = {}) {
  return initializeGameState(roster, options);
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

const STAGE_DISTRIBUTIONS = [
  { neutral: 80, weak: 20 },
  { neutral: 45, weak: 40, connecting: 15 },
  { neutral: 20, weak: 35, connecting: 30, strong: 15 },
  { neutral: 10, weak: 20, connecting: 30, strong: 30, veryStrong: 10 },
  { neutral: 5, weak: 10, connecting: 20, strong: 40, veryStrong: 25 },
];

const STAGE_THRESHOLDS = [0, 4, 7, 11, 15];

function stageForClueCount(count) {
  for (let stage = STAGE_DISTRIBUTIONS.length - 1; stage >= 0; stage -= 1) {
    if (count >= STAGE_THRESHOLDS[stage]) return stage;
  }
  return 0;
}

function chooseClueTier(random, clueCount, lastLevelId, availableLevelIds) {
  const stage = stageForClueCount(clueCount);
  const dist = STAGE_DISTRIBUTIONS[stage];
  const levels = CLUE_LEVELS
    .filter(({ id }) => dist[id] !== undefined && availableLevelIds.includes(id))
    .map(({ id }) => ({ id, weight: dist[id] }));
  if (!levels.length) return null;
  const sameLevel = levels.find(({ id }) => id === lastLevelId);
  const otherLevels = levels.filter(({ id }) => id !== lastLevelId);
  if (sameLevel && otherLevels.length) {
    for (const lvl of levels) {
      if (lvl.id === lastLevelId) lvl.weight *= 0.4;
    }
  }
  const total = levels.reduce((sum, lvl) => sum + lvl.weight, 0);
  const roll = random() * total;
  let cumulative = 0;
  for (const lvl of levels) {
    cumulative += lvl.weight;
    if (roll < cumulative) return lvl.id;
  }
  return levels[levels.length - 1].id;
}

export function giveClue(gameState, playerId, requestedLevel = null, random = Math.random) {
  const scenario = SCENARIOS.find(({ id }) => id === gameState.scenarioId);
  const availableAt = (levelId) => [
    ...scenario.clues[levelId],
    ...(levelId === "neutral" ? scenario.clues.neutralCategory ?? [] : []),
  ].filter((clue) => !gameState.usedClues.includes(`${scenario.id}:${clue.id}`));
  const stageAllowed = CLUE_LEVELS.map(({ id }) => ({ id, clues: availableAt(id) }))
    .filter((entry) => entry.clues.length);
  const availableLevelIds = stageAllowed.map(({ id }) => id);
  if (!availableLevelIds.length) return null;
  const lastGiven = gameState.lastClueLevel ?? null;
  let level = requestedLevel;
  if (!level || !availableLevelIds.includes(level)) {
    level = chooseClueTier(random, gameState.usedClues.length, lastGiven, availableLevelIds);
  }
  if (!level) return null;
  let pool = availableAt(level);
  if (!pool.length) {
    const candidates = availableLevelIds
      .map((id) => ({ id, clues: availableAt(id) }))
      .filter(({ clues }) => clues.length)
      .sort((a, b) => {
        const distA = CLUE_LEVELS.findIndex(({ id }) => id === a.id);
        const distB = CLUE_LEVELS.findIndex(({ id }) => id === b.id);
        const target = CLUE_LEVELS.findIndex(({ id }) => id === level);
        return Math.abs(distA - target) - Math.abs(distB - target);
      });
    if (!candidates.length) return null;
    level = candidates[0].id;
    pool = availableAt(level);
  }
  const clue = choose(pool, random);
  const record = {
    id: `${scenario.id}:${clue.id}`,
    level,
    text: renderClueText(clue.text, gameState, playerId, random),
  };
  gameState.usedClues.push(record.id);
  gameState.lastClueLevel = level;
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
