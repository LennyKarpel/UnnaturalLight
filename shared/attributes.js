/** What a light's channels control (each 0–255), shared by the stage, its fixture library and traces. */

export const DMX_ATTRS = /** @type {const} */ (["dimmer", "pan", "tilt", "red", "green", "blue", "zoom"]);
export const DMX_LABELS = { dimmer: "Dimmer", pan: "Pan", tilt: "Tilt", red: "Red", green: "Green", blue: "Blue", zoom: "Zoom" };
/** Short names used for console fader names, e.g. "Inst 1 Dim". */
export const DMX_SHORT = { dimmer: "Dim", pan: "Pan", tilt: "Tilt", red: "R", green: "G", blue: "B", zoom: "Zoom" };
