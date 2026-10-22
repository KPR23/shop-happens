import { registerMinigame } from "./registry";
import { CheckoutGame } from "./checkout";
import { UnpackGame } from "./unpack";

// Add new minigames here (kind + config live in packages/shared/src/minigames.ts).
registerMinigame("checkout", () => new CheckoutGame());
registerMinigame("unpack", () => new UnpackGame());

export { MinigameManager, type MinigameHooks } from "./manager";
export { createMinigame, registerMinigame, registeredMinigames } from "./registry";
export type { Minigame, MinigameChannel, MinigameContext, MinigameUi } from "./types";
export { LocalMinigameChannel, NetworkMinigameChannel } from "./channels";
