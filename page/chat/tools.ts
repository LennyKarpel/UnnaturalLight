/**
 * The chat's tools: what the model may look at and do. Each runs here in
 * the page and calls the console (window.consoleChat, console/chat-hooks.ts)
 * or the stage (window.stageChat, stage/chat-hooks.ts), the same as its own
 * controls, so changes reach the show server and the other windows the
 * usual way. The tools themselves are in ./tools/, a file per group; what
 * they share (their shape, reading songs, cues and levels) is in
 * ./tools/common.ts.
 *
 * Add a tool: give it a name, a description the model reads, a JSON Schema
 * for its arguments, a short line for the chat (`describe`) and `run`.
 * Tools run as soon as the model calls them: nothing asks first.
 */

import type { ToolDef } from "./tools/common.ts";
import { PLAYBACK_TOOLS } from "./tools/playback.ts";
import { CUE_TOOLS } from "./tools/cues.ts";
import { SET_TOOLS } from "./tools/sets.ts";
import { FIXTURE_TOOLS } from "./tools/fixtures.ts";
import { OUTPUT_TOOLS } from "./tools/outputs.ts";
import { SHOW_TOOLS } from "./tools/show.ts";
import { STAGE_TOOLS } from "./tools/stage.ts";

export type { Args, ToolDef } from "./tools/common.ts";

/**
 * Every tool. Playback is always in the model's view (it's what a show
 * needs, quickly); the rest are deferred: found by the model's tool search
 * when a request needs them (see ChatTool.deferred).
 */
export const TOOLS: ToolDef[] = [
  ...PLAYBACK_TOOLS,
  ...[...CUE_TOOLS, ...SET_TOOLS, ...FIXTURE_TOOLS, ...OUTPUT_TOOLS, ...SHOW_TOOLS, ...STAGE_TOOLS].map((t) => ({ ...t, deferred: true })),
];
export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
