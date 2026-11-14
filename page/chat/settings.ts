/**
 * The chat's settings dialog (⚙ in the chat panel's header, or its model's
 * name): which model answers, and whether the panel shows details (what each
 * tool was sent and answered, the model's tool searches, each request's
 * model, time and tokens). Changes apply at once; the panel (./panel.ts)
 * keeps them in this browser. The confirm dialog's look (dialog.ask, theme.css).
 */

import type { ChatModels } from "../../shared/chat-protocol.ts";
import { button, el } from "../../shared/html.ts";

export type ChatSettings = {
  /** The show server's models, or null while they load / when it has none (`modelsError` says why). */
  models: ChatModels | null;
  modelsError: string;
  /** The picked model ("" = the server's default). */
  model: string;
  details: boolean;
  /** A model was picked ("" = the server's default). */
  onModel: (id: string) => void;
  onDetails: (on: boolean) => void;
};

let dlg: HTMLDialogElement | null = null;
/** Redraws the open dialog's model list (the models may arrive after it opens). */
let redrawModels: ((s: ChatSettings) => void) | null = null;

/** The models came in (or failed): update the dialog if it's open. */
export function updateChatSettings(s: ChatSettings) {
  if (dlg?.open) redrawModels?.(s);
}

export function openChatSettings(s: ChatSettings) {
  dlg?.remove();
  const d = el("dialog", "ask chat-settings");
  dlg = d;
  d.setAttribute("aria-label", "Chat settings");
  const form = el("form", "");
  form.method = "dialog";

  // Model: one radio per model, its note beside it.
  const modelSet = el("fieldset", "chat-settings-models");
  const modelList = el("div", "");
  modelSet.append(el("legend", "", "Model"), modelList);
  let picked = s.model;
  const drawModels = (now: ChatSettings) => {
    modelList.replaceChildren();
    if (!now.models) {
      modelList.append(el("p", "chat-settings-note", now.modelsError ? `Can't list the models: ${now.modelsError}` : "Loading…"));
      return;
    }
    const { models, default: dflt } = now.models;
    const current = picked || dflt;
    for (const m of models) {
      const row = el("label", "chat-settings-choice");
      const radio = el("input", "");
      radio.type = "radio";
      radio.name = "chat-model";
      radio.value = m.id;
      radio.checked = m.id === current;
      radio.addEventListener("change", () => {
        picked = m.id === dflt ? "" : m.id;
        now.onModel(picked);
      });
      const text = el("span", "chat-settings-text");
      text.append(el("span", "chat-settings-name", m.name), el("span", "chat-settings-note", m.note));
      row.title = m.id;
      row.append(radio, text);
      modelList.append(row);
    }
    modelList.append(el("p", "chat-settings-note", "Used from your next message on, in every chat."));
  };
  drawModels(s);
  redrawModels = drawModels;

  // Show details.
  const showSet = el("fieldset", "");
  const row = el("label", "chat-settings-choice");
  const box = el("input", "");
  box.type = "checkbox";
  box.checked = s.details;
  box.addEventListener("change", () => s.onDetails(box.checked));
  const text = el("span", "chat-settings-text");
  text.append(
    el("span", "chat-settings-name", "Show details"),
    el("span", "chat-settings-note", "Click a tool's line to see what it was sent and answered; also the model's tool searches, and under each request its model, time and tokens."),
  );
  row.append(box, text);
  showSet.append(el("legend", "", "Show"), row);

  const done = button("primary", "Done");
  done.type = "submit";
  const actions = el("div", "ask-actions");
  actions.append(done);
  form.append(el("h2", "", "Chat settings"), modelSet, showSet, actions);
  d.append(form);
  // Keys typed here aren't for the console or the stage.
  d.addEventListener("keydown", (e) => e.stopPropagation());
  d.addEventListener("close", () => {
    d.remove();
    if (dlg === d) {
      dlg = null;
      redrawModels = null;
    }
  }, { once: true });
  document.body.append(d);
  d.showModal();
  (modelList.querySelector<HTMLInputElement>("input:checked") ?? done).focus();
}
