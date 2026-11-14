/** The chat's show file tools: rename and save the show. */

import { type ToolDef, api } from "./common.ts";

export const SHOW_TOOLS: ToolDef[] = [
  {
    name: "rename_show",
    description: "Rename the show (its name in the page header, and the show file's name when it's saved).",
    schema: { type: "object", properties: { name: { type: "string", maxLength: 80 } }, required: ["name"], additionalProperties: false },
    describe: (a) => `Rename the show to "${a.name}"`,
    run: (a) => ({ name: api().renameShow(String(a.name ?? "")) }),
  },
  {
    name: "save_show",
    description:
      "Save the show: download the show file (songs, sets, cues, patch, fixtures, the stage and the chats) to this browser's downloads. Give a name to rename the show first (the file is named after it).",
    schema: { type: "object", properties: { name: { type: "string", maxLength: 80 } }, additionalProperties: false },
    describe: (a) => (a.name ? `Save the show as "${a.name}"` : "Save the show"),
    run: async (a) => {
      if (a.name != null) api().renameShow(String(a.name));
      const complete = await api().saveShow();
      return { saved: api().show().showName, ...(complete ? {} : { note: "The show server is offline: the file has no stage or chats" }) };
    },
  },
];
