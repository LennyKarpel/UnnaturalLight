/** What a fixture's channels control (each 0–255), shared by the stage, its fixture library and traces. */

export const DMX_ATTRS = /** @type {const} */ (["dimmer", "pan", "tilt", "red", "green", "blue", "deepred", "white", "amber", "lime", "cyan", "indigo", "uv", "zoom"]);
export const DMX_LABELS = { dimmer: "Dimmer", pan: "Pan", tilt: "Tilt", red: "Red", green: "Green", blue: "Blue", deepred: "Deep Red", white: "White", amber: "Amber", lime: "Lime", cyan: "Cyan", indigo: "Indigo", uv: "UV", zoom: "Zoom" };
/** Short names used for console fader names, e.g. "Inst 1 Dim". */
export const DMX_SHORT = { dimmer: "Dim", pan: "Pan", tilt: "Tilt", red: "R", green: "G", blue: "B", deepred: "DR", white: "W", amber: "A", lime: "L", cyan: "C", indigo: "I", uv: "UV", zoom: "Zoom" };
