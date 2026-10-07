import {
  canAccuse,
  chooseMiniGame,
  createGame,
  launchMiniGame,
  nextTurn,
  resolveAccusation,
  resolveMiniGame,
  returnFromMiniGame,
  selectOpponent,
  selectRoom,
  startAccusation,
  startTurn,
} from "./game-engine.js";
import { ROOMS, SCENARIOS } from "./game-data.js";
import { clearSavedSession, loadSavedSession, saveSession } from "./storage.js";

const app = document.querySelector("#app");
const stateFromStorage = loadSavedSession();
let gameState = stateFromStorage.gameState;
let previousRoomGameSets = stateFromStorage.previousRoomGameSets;
let isLaunchingMiniGame = false;
let configuredPlayers = [];
let rosterLoading = true;
let rosterError = "";
let notice = "";

const returnParams = new URLSearchParams(location.search);
if (returnParams.get("miniGameReturn") === "1" && gameState) {
  try {
    const callbackSessionId = returnParams.get("sessionId");
    if (gameState.phase === "miniGame") {
      returnFromMiniGame(gameState, callbackSessionId);
      saveSession(gameState, previousRoomGameSets);
    } else if (gameState.pendingMiniGame?.sessionId !== callbackSessionId) {
      throw new Error("Сессия мини-игры не совпадает с текущей партией.");
    }
    const cleanUrl = new URL(location.href);
    cleanUrl.search = "";
    cleanUrl.hash = "";
    history.replaceState({}, "", cleanUrl);
  } catch (error) {
    notice = error.message;
  }
}

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

const PLAYER_SLOT_IDS = ["1", "2", "3", "4", "5", "6"];

async function loadConfiguredPlayers() {
  const configResponse = await fetch("./author/players.json", { cache: "no-store" });
  if (!configResponse.ok) throw new Error("Не удалось загрузить author/players.json.");
  const config = await configResponse.json();
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Проверьте формат author/players.json.");
  }

  const slots = await Promise.all(PLAYER_SLOT_IDS.map(async (id) => {
    const avatar = `./author/players/${id}.jpg`;
    try {
      let response = await fetch(avatar, { method: "HEAD", cache: "no-store" });
      if (response.status === 405 || response.status === 501) {
        response = await fetch(avatar, { cache: "no-store" });
      }
      if (!response.ok && response.status !== 404) {
        throw new Error(`Не удалось проверить фотографию игрока ${id}.`);
      }
      return { id, avatar, exists: response.ok && response.status !== 204 };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Не удалось проверить фотографию")) {
        throw error;
      }
      throw new Error("Не удалось проверить фотографии игроков.");
    }
  }));

  let lastActiveSlot = -1;
  slots.forEach((slot, index) => {
    if (slot.exists) lastActiveSlot = index;
  });
  if (lastActiveSlot < 0) {
    throw new Error("Добавьте фотографии минимум четырёх игроков: 1.jpg–4.jpg.");
  }
  if (slots.slice(0, lastActiveSlot + 1).some(({ exists }) => !exists)) {
    throw new Error("Проверьте фотографии игроков. Игроки должны идти последовательно от 1.");
  }
  if (lastActiveSlot + 1 < 4) {
    throw new Error("Для игры нужны фотографии как минимум четырёх игроков: 1.jpg–4.jpg.");
  }

  const players = slots.slice(0, lastActiveSlot + 1).map(({ id, avatar }) => {
    const name = config[id]?.name;
    if (typeof name !== "string" || !name.trim()) {
      throw new Error(`Укажите имя игрока ${id} в author/players.json.`);
    }
    return { id, name: name.trim(), avatar };
  });
  if (new Set(players.map(({ name }) => name.toLocaleLowerCase("ru"))).size !== players.length) {
    throw new Error("Имена игроков в author/players.json должны различаться.");
  }
  return players;
}

function renderPlayer(player, size = "regular") {
  if (!player) return "";
  const avatar = typeof player.avatar === "string" && player.avatar
    ? `<img class="player-avatar" src="${escapeHTML(player.avatar)}" alt="" aria-hidden="true">`
    : "";
  return `
    <span class="player-identity player-identity--${size}">
      ${avatar}
      <span class="player-identity__name">${escapeHTML(player.name ?? "")}</span>
    </span>
  `;
}

const playerById = (id) => gameState?.players.find((player) => player.id === id);
const currentPlayer = () => playerById(gameState?.currentPlayerId);
const victim = () => playerById(gameState?.victimId);
const culprit = () => playerById(gameState?.culpritId);
const scenario = () => SCENARIOS.find(({ id }) => id === gameState?.scenarioId);

function eventDescription() {
  const event = scenario()?.event;
  if (!event || event.type !== "text") return "";
  const name = victim()?.name ?? "";
  const feminine = /[ая]$/i.test(name);
  let description = event.description.replaceAll("[ЖЕРТВА]", name);
  if (feminine) {
    description = description
      .replaceAll("проснулся", "проснулась")
      .replaceAll("обнаружил", "обнаружила")
      .replaceAll("обмотан", "обмотана")
      .replaceAll("оказался спящим", "оказалась спящей");
  }
  return description;
}

function nameForm(player, form) {
  const name = player?.name ?? "";
  if (form === "nom") return name;
  const feminine = /[ая]$/i.test(name);
  const ending = name.slice(-1).toLocaleLowerCase("ru");

  if (feminine) {
    if (ending === "а") {
      const stem = name.slice(0, -1);
      if (form === "acc") return `${stem}у`;
      if (form === "dat") return `${stem}е`;
      const previous = stem.slice(-1).toLocaleLowerCase("ru");
      return `${stem}${/[гкхжчшщ]$/.test(previous) ? "и" : "ы"}`;
    }
    if (ending === "я") {
      const stem = name.slice(0, -1);
      if (form === "acc") return `${stem}ю`;
      if (form === "dat") return `${stem}${stem.endsWith("и") ? "и" : "е"}`;
      return `${stem}и`;
    }
  } else {
    if (ending === "й" || ending === "ь") {
      return `${name.slice(0, -1)}${form === "dat" ? "ю" : "я"}`;
    }
    if (/[бвгджзйклмнпрстфхцчшщ]$/i.test(name)) {
      return `${name}${form === "dat" ? "у" : "а"}`;
    }
  }
  return name;
}

function reasonDescription() {
  const template = scenario()?.reason ?? "";
  return template.replace(/\{([VC]):([^{}]+)\}/g, (_, role, specifier) => {
    const player = role === "V" ? victim() : culprit();
    if (["nom", "gen", "dat", "acc"].includes(specifier)) {
      return nameForm(player, specifier);
    }
    if (["poss", "pron"].includes(specifier)) return /[ая]$/i.test(player?.name ?? "") ? "её" : "его";
    if (specifier === "subj") return /[ая]$/i.test(player?.name ?? "") ? "она" : "он";
    const [masculine, feminineForm] = specifier.split("|");
    return /[ая]$/i.test(player?.name ?? "") ? feminineForm : masculine;
  });
}

function persist() {
  saveSession(gameState, previousRoomGameSets);
}

function actionButton(label, action, className = "primary-button", extra = "") {
  return `<button class="${className}" data-action="${action}" ${extra}>${label}</button>`;
}

function renderTopbar() {
  const isFinished = ["victory", "finalReveal"].includes(gameState?.phase);
  return `
    <header class="topbar">
      <p class="wordmark">ВНЕЭКРАН</p>
      ${gameState && !isFinished ? actionButton("НОВАЯ ПАРТИЯ", "new-game", "secondary-button") : ""}
    </header>
  `;
}

function renderSetup() {
  const rosterContent = rosterLoading
    ? '<p class="lead">Загружаем состав игроков…</p>'
    : rosterError
      ? `<p class="notice" role="alert">${escapeHTML(rosterError)}</p>`
      : `
        <div class="player-roster player-roster--count-${configuredPlayers.length}">
          ${configuredPlayers.map((player) => `
            <div class="player-roster-item">${renderPlayer(player)}</div>
          `).join("")}
        </div>
      `;
  const disabled = rosterLoading || Boolean(rosterError) || configuredPlayers.length < 4;
  return `
    <section class="content setup-screen">
      <div class="eyebrow">Игроки</div>
      <h1>Соберите<br>компанию.</h1>
      <p class="lead">Участники расследования.</p>
      ${rosterContent}
      <div class="button-stack">${actionButton("НАЧАТЬ ИГРУ", "start-game", "primary-button", disabled ? "disabled" : "")}</div>
    </section>
  `;
}

function renderBriefing() {
  return `
    <section class="content">
      <p class="event-description">${escapeHTML(eventDescription())}</p>
      <div class="button-stack">${actionButton("НАЧАТЬ РАССЛЕДОВАНИЕ", "begin-investigation")}</div>
    </section>
  `;
}

function renderAccuseButton() {
  if (!canAccuse(gameState)) return "";
  return `<div class="button-stack">${actionButton("Я ОБВИНЯЮ", "start-accusation", "secondary-button")}</div>`;
}

function renderOpponentPicker() {
  if (!gameState.selectedRoomId) {
    return `
      <div class="section-space">
        <div class="eyebrow">Выберите комнату</div>
        <div class="room-grid section-space">
          ${ROOMS.map(({ id, name }) => `
            <button class="room-button" data-action="select-room" data-id="${id}">${escapeHTML(name)}</button>
          `).join("")}
        </div>
      </div>
    `;
  }
  const previousPair = gameState.lastCallerId === gameState.currentPlayerId
    ? gameState.lastCalledPlayerId
    : null;
  const opponents = gameState.players
    .filter(({ active, id }) => active && id !== gameState.currentPlayerId)
    .map((player) => {
      const blocked = player.id === previousPair;
      return `
        <button class="player-button" data-action="select-opponent" data-id="${player.id}" ${blocked ? "disabled" : ""}>
          ${renderPlayer(player, "compact")}
          ${blocked ? '<span class="button-note">Соперник предыдущего вызова</span>' : ""}
        </button>
      `;
    }).join("");
  const room = ROOMS.find(({ id }) => id === gameState.selectedRoomId);
  return `
    <div class="section-space">
      <div class="eyebrow">Кого вызвать? · ${escapeHTML(room?.name ?? "")}</div>
      <div class="player-list">${opponents}</div>
      <div class="button-stack">
        ${actionButton("ВЫБРАТЬ ДРУГУЮ КОМНАТУ", "change-room", "secondary-button")}
      </div>
    </div>
  `;
}

function renderTurn() {
  return `
    <section class="content">
      <div class="turn-heading">
        <div>
          <div class="eyebrow">Ход игрока</div>
          <h1>${renderPlayer(currentPlayer(), "large")}</h1>
        </div>
        <div class="turn-number">ХОД ${gameState.turnNumber}</div>
      </div>
      ${renderOpponentPicker()}
      ${renderAccuseButton()}
    </section>
  `;
}

function renderUnavailableMiniGame() {
  return `
    <section class="content center-card">
      <div class="eyebrow">Мини-игра недоступна</div>
      <h1>Файл игры не найден.</h1>
      <p class="lead">Сохранённая партия остаётся на месте.</p>
      <div class="button-stack">${actionButton("ВЕРНУТЬСЯ К ВЫБОРУ ПОБЕДИТЕЛЯ", "return-from-minigame")}</div>
    </section>
  `;
}

function renderWinnerPick() {
  const pending = gameState.pendingMiniGame;
  const caller = playerById(pending?.callerId);
  const opponent = playerById(pending?.opponentId);
  return `
    <section class="content">
      <div class="eyebrow">Раунд завершён</div>
      <h1>Кто победил?</h1>
      <p class="lead">Выберите победителя. Награда будет выдана автоматически.</p>
      <div class="choice-grid">
        <button class="choice-button" data-action="winner" data-id="${caller?.id}">
          ${renderPlayer(caller, "compact")}
        </button>
        <button class="choice-button" data-action="winner" data-id="${opponent?.id}">
          ${renderPlayer(opponent, "compact")}
        </button>
      </div>
    </section>
  `;
}

function renderReward() {
  const reward = gameState.lastReward;
  const winner = playerById(reward?.playerId);
  const contents = reward?.type === "clue"
    ? `
      <div class="clue-box">${escapeHTML(reward.clue.text)}</div>
    `
    : `
      <div class="bonus-mark">БОНУС</div>
      <p class="lead">Физический жетон получает ${renderPlayer(winner, "compact")}.</p>
    `;
  return `
    <section class="content">
      <div class="eyebrow">Победитель · ${renderPlayer(winner, "compact")}</div>
      <h1>Награда.</h1>
      <article class="card">${contents}</article>
      <div class="button-stack">${actionButton("ПРОДОЛЖИТЬ", "continue")}</div>
    </section>
  `;
}

function renderAccusationPick() {
  return `
    <section class="content">
      <div class="eyebrow">Решающий момент</div>
      <h1>Кого обвиняете?</h1>
      <div class="player-list">
        ${gameState.players.map((player) => `
            <button class="player-button" data-action="pick-accusation" data-id="${player.id}">
              ${renderPlayer(player, "compact")}
            </button>
          `).join("")}
      </div>
      <div class="button-stack">${actionButton("НАЗАД", "cancel-accusation", "secondary-button")}</div>
    </section>
  `;
}

function renderAccusationConfirm() {
  const target = playerById(gameState.accusationTargetId);
  return `
    <section class="content center-card">
      <div class="eyebrow">Подтвердите обвинение</div>
      <h1>Вы уверены?</h1>
      <p class="confirmation">Вы обвиняете ${renderPlayer(target, "compact")}?</p>
      <div class="button-stack">
        ${actionButton("ПОДТВЕРДИТЬ", "confirm-accusation")}
        ${actionButton("НАЗАД", "back-to-accusation", "secondary-button")}
      </div>
    </section>
  `;
}

function renderWrongAccusation() {
  const accused = playerById(gameState.accusationResult?.accuserId);
  return `
    <section class="content center-card">
      <div class="big-mark">×</div>
      <div class="eyebrow">Обвинение не подтвердилось</div>
      <h1>Неверно.</h1>
      <p class="lead">${accused ? renderPlayer(accused, "compact") : "Игрок"} выбывает из расследования.</p>
      <div class="button-stack">${actionButton("ПЕРЕДАТЬ ХОД", "continue")}</div>
    </section>
  `;
}

function renderVictory() {
  const winner = playerById(gameState.gameResult?.winnerId);
  return `
    <section class="content center-card">
      <div class="big-mark">✓</div>
      <div class="eyebrow">Расследование завершено</div>
      <h1>Вы нашли виновника.</h1>
      <p class="lead">${renderPlayer(winner, "compact")} раскрыл дело.</p>
      ${renderCaseReveal(true)}
      <div class="button-stack">${actionButton("НОВАЯ ПАРТИЯ", "new-game")}</div>
    </section>
  `;
}

function renderFinalReveal() {
  return `
    <section class="content center-card">
      <div class="eyebrow">Расследование завершено</div>
      <h1>Виновник раскрыт.</h1>
      ${renderCaseReveal()}
      <div class="button-stack">${actionButton("НОВАЯ ПАРТИЯ", "new-game")}</div>
    </section>
  `;
}

function renderCaseReveal(includeReason = false) {
  return `
    <article class="card" style="text-align:left">
      <div class="eyebrow">Жертва</div>
      <h2>${renderPlayer(victim(), "large")}</h2>
      <p class="event-description">${escapeHTML(eventDescription())}</p>
      <div class="eyebrow section-space">Виновник</div>
      <h2>${renderPlayer(culprit(), "large")}</h2>
      ${includeReason ? `
        <div class="eyebrow section-space">Почему?</div>
        <p class="event-description">${escapeHTML(reasonDescription())}</p>
      ` : ""}
    </article>
  `;
}
function renderRecovery(title, detail) {
  return `
    <section class="content center-card">
      <div class="eyebrow">ВНЕЭКРАН</div>
      <h1>${escapeHTML(title)}</h1>
      <p class="lead">${escapeHTML(detail)}</p>
      <div class="button-stack">${actionButton("К НАЧАЛУ", "reset")}</div>
    </section>
  `;
}

function renderContent() {
  if (!gameState) return renderSetup();
  switch (gameState.phase) {
    case "briefing": return renderBriefing();
    case "turn": return renderTurn();
    case "miniGame": return renderUnavailableMiniGame();
    case "winnerPick": return renderWinnerPick();
    case "reward": return renderReward();
    case "accusePick": return gameState.accusationTargetId
      ? renderAccusationConfirm()
      : renderAccusationPick();
    case "wrongAccusation": return renderWrongAccusation();
    case "victory": return renderVictory();
    case "finalReveal": return renderFinalReveal();
    default: return renderRecovery("Партия не найдена", "Начните новую игру.");
  }
}

function render() {
  app.innerHTML = `
    ${renderTopbar()}
    ${notice ? `<p class="notice" role="alert">${escapeHTML(notice)}</p>` : ""}
    ${renderContent()}
  `;
}

function showError(error) {
  notice = error instanceof Error ? error.message : String(error);
  render();
}

function baseReturnUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.href;
}

function miniGameReturnUrl(sessionId) {
  const url = new URL(baseReturnUrl());
  url.searchParams.set("miniGameReturn", "1");
  url.searchParams.set("sessionId", sessionId);
  return url.href;
}

async function discoverMiniGames(setId) {
  const discovery = (async () => {
    const games = [];
    for (let number = 1; ; number += 1) {
      const gameId = "game" + String(number).padStart(2, "0");
      try {
        const path = "./games/" + setId + "/" + gameId + "/index.html";
        let response = await fetch(path, { method: "HEAD", cache: "no-store" });
        if (response.status === 405 || response.status === 501) response = await fetch(path, { cache: "no-store" });
        if (!response.ok) break;
        games.push(gameId);
      } catch {
        break;
      }
    }
    return games;
  })();
  return discovery;
}

function startNewGame() {
  if (!gameState?.players.length) {
    resetGame();
    return;
  }
  if (rosterLoading) throw new Error("Состав игроков ещё загружается.");
  if (rosterError) throw new Error(rosterError);
  gameState = createGame(configuredPlayers, { previousRoomGameSets });
  previousRoomGameSets = gameState.roomGameSets;
  notice = "";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  history.replaceState({}, "", url);
  persist();
  render();
}

function resetGame() {
  clearSavedSession();
  gameState = null;
  notice = "";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  history.replaceState({}, "", url);
  render();
}

app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action } = button.dataset;
  notice = "";
  try {
    if (action === "start-game") {
      if (rosterLoading) throw new Error("Состав игроков ещё загружается.");
      if (rosterError) throw new Error(rosterError);
      gameState = createGame(configuredPlayers, { previousRoomGameSets });
      previousRoomGameSets = gameState.roomGameSets;
      persist();
    } else if (action === "begin-investigation") {
      startTurn(gameState);
      persist();
    } else if (action === "select-room") {
      selectRoom(gameState, button.dataset.id);
      persist();
    } else if (action === "change-room") {
      gameState.selectedRoomId = null;
      gameState.selectedOpponentId = null;
      persist();
    } else if (action === "select-opponent") {
      if (isLaunchingMiniGame) return;
      isLaunchingMiniGame = true;
      try {
        const setId = gameState.roomGameSets[gameState.selectedRoomId];
        const availableGames = await discoverMiniGames(setId);
        if (!availableGames.length) throw new Error("В этой комнате пока нет доступных файлов мини-игр.");
        selectOpponent(gameState, button.dataset.id);
        const gameId = chooseMiniGame(gameState, availableGames);
        const gameUrl = "./games/" + setId + "/" + gameId + "/index.html";
        const returnUrl = miniGameReturnUrl(gameState.sessionId);
        const url = launchMiniGame(gameState, gameUrl, returnUrl);
        persist();
        window.location.href = url;
        return;
      } finally {
        isLaunchingMiniGame = false;
      }
    } else if (action === "return-from-minigame") {
      const params = new URLSearchParams(location.search);
      const sessionId = params.get("sessionId") || gameState.sessionId;
      returnFromMiniGame(gameState, sessionId);
      persist();
      window.location.href = baseReturnUrl();
      return;
    } else if (action === "winner") {
      resolveMiniGame(gameState, button.dataset.id);
      persist();
    } else if (action === "continue") {
      nextTurn(gameState);
      persist();
    } else if (action === "start-accusation") {
      startAccusation(gameState);
      persist();
    } else if (action === "pick-accusation") {
      gameState.accusationTargetId = button.dataset.id;
      persist();
    } else if (action === "cancel-accusation") {
      gameState.accusationTargetId = null;
      gameState.phase = "turn";
      persist();
    } else if (action === "back-to-accusation") {
      gameState.accusationTargetId = null;
      persist();
    } else if (action === "confirm-accusation") {
      resolveAccusation(gameState, gameState.accusationTargetId);
      persist();
    } else if (action === "new-game") {
      startNewGame();
      return;
    } else if (action === "reset") {
      resetGame();
      return;
    }
    render();
  } catch (error) {
    showError(error);
  }
});

render();
loadConfiguredPlayers()
  .then((players) => {
    configuredPlayers = players;
    rosterError = "";
    rosterLoading = false;
    if (!gameState) render();
  })
  .catch((error) => {
    rosterError = error instanceof Error ? error.message : String(error);
    rosterLoading = false;
    if (!gameState) render();
  });
