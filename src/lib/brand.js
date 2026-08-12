// What the product calls itself, in one place.
//
// The mode name is deliberately separate from the model underneath: the app is
// Selflight whichever provider is answering, and a person shouldn't have to
// learn what "sonar-reasoning-pro" is to understand what they're talking to.

// Selflight is the product and the assistant. Iris is what it runs on — the
// same split as an app and its model, so the version can move without the
// product being renamed every time it gets better.
export const NAME = "Selflight";
export const MODE = "Iris 6.0";

// Effort, in the app's own terms rather than the provider's. The costs are
// rough per-message figures on Perplexity — worth showing at the point of
// choosing, since this is the setting that decides the bill.
export const EFFORTS = [
  { id: "quick", name: "Quick", note: "Shallow search, fastest answer", cost: "~0.8¢" },
  { id: "balanced", name: "Balanced", note: "A good default for most questions", cost: "~2.6¢" },
  { id: "deep", name: "Deep", note: "Reads widely and shows its reasoning", cost: "~2.4¢" }
];

export function effortFor(settings = {}) {
  return EFFORTS.find((e) => e.id === settings.depth) || EFFORTS[1];
}

export function modeLabel(settings = {}) {
  return `${MODE} · ${effortFor(settings).name}`;
}
