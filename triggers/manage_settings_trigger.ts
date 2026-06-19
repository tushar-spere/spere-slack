import { Trigger } from "deno-slack-api/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { ManageSettingsWorkflow } from "../workflows/manage_settings_workflow.ts";

/**
 * THE ADMIN ENTRY POINT
 * A Shortcut trigger for configuring the tenant's database schema.
 */
const manageSettingsTrigger: Trigger<typeof ManageSettingsWorkflow.definition> =
  {
    type: TriggerTypes.Shortcut,
    name: "Setup",
    description: "Manage Data Model",
    workflow: `#/workflows/${ManageSettingsWorkflow.definition.callback_id}`,
    inputs: {
      interactivity: {
        value: TriggerContextData.Shortcut.interactivity,
      },
      channel: {
        value: TriggerContextData.Shortcut.channel_id,
      },
    },
  };

export default manageSettingsTrigger;
