// What the product calls itself, in one place.
//
// The mode name is deliberately separate from the model underneath: the app is
// Selflight whichever provider is answering, and a person shouldn't have to
// learn what "sonar-reasoning-pro" is to understand what they're talking to.

export const NAME = "Selflight";

// Bump this when the behaviour changes enough that someone would notice.
export const MODE = "Selflight 6.0";

// The thinking-depth setting qualifies the mode rather than replacing it.
export const DEPTH_LABELS = {
  quick: "Quick",
  balanced: "Balanced",
  deep: "Deep"
};

export function modeLabel(settings = {}) {
  const depth = DEPTH_LABELS[settings.depth];
  return depth && settings.depth !== "balanced" ? `${MODE} · ${depth}` : MODE;
}
