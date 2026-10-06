import { CATEGORIES, ROOMS } from "./game-data.js";

const STORAGE_KEY = "vneekran.game.v1";
const GAME_SET_IDS = [1, 2, 3, 4, 5, 6];

function migrateGameSets(mapping) {
  if (!mapping) return null;
  return Object.fromEntries(ROOMS.map(({ id }, index) => {
    const value = mapping[id];
    if (Number.isInteger(value) && GAME_SET_IDS.includes(value)) return [id, value];
    const oldIndex = CATEGORIES.findIndex(({ id: categoryId }) => categoryId === value);
    return [id, oldIndex >= 0 ? oldIndex + 1 : index + 1];
  }));
}

function migrateGameState(gameState) {
  if (!gameState) return null;
  gameState.roomGameSets ??= migrateGameSets(gameState.roomCategories);
  delete gameState.roomCategories;
  gameState.miniGamePoolsBySet ??= Object.fromEntries(GAME_SET_IDS.map((id) => [id, { used: [], remaining: [] }]));
  if (gameState.pendingMiniGame && !gameState.pendingMiniGame.setId) {
    gameState.pendingMiniGame.setId = gameState.roomGameSets?.[gameState.pendingMiniGame.roomId] ?? null;
  }
  return gameState;
}

export function loadSavedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { gameState: null, previousRoomGameSets: null };
    const saved = JSON.parse(raw);
    return {
      gameState: migrateGameState(saved.gameState ?? null),
      previousRoomGameSets: migrateGameSets(saved.previousRoomGameSets ?? saved.previousRoomCategories),
    };
  } catch (error) {
    console.warn("Не удалось прочитать сохранённую партию.", error);
    return { gameState: null, previousRoomGameSets: null };
  }
}

export function saveSession(gameState, previousRoomGameSets = null) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    gameState,
    previousRoomGameSets: previousRoomGameSets ?? gameState?.roomGameSets ?? null,
  }));
}

export function clearSavedSession() {
  localStorage.removeItem(STORAGE_KEY);
}
