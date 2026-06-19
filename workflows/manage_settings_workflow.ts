import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { ManageSettingsFunctionDefinition } from "../functions/manage_settings.ts";

export const ManageSettingsWorkflow = DefineWorkflow({
  callback_id: "manage_settings_workflow",
  title: "Configure App Settings",
  description: "Dynamic control panel to manage custom product fields",
  input_parameters: {
    properties: {
      interactivity: { type: Schema.slack.types.interactivity },
      channel: { type: Schema.slack.types.channel_id },
    },
    required: ["interactivity", "channel"],
  },
});

// We pass control directly to our new Dashboard function
ManageSettingsWorkflow.addStep(ManageSettingsFunctionDefinition, {
  interactivity: ManageSettingsWorkflow.inputs.interactivity,
});
