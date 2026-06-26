import { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { Customer360Workflow } from "../workflows/customer_360_workflow.ts";

const customer360Trigger: Trigger = {
  type: TriggerTypes.Shortcut,
  name: "Customer 360",
  description: "Launch the Executive Customer 360 Command Center",
  workflow: `#/workflows/${Customer360Workflow.definition.callback_id}`,
  inputs: {
    interactivity: {
      value: TriggerContextData.Shortcut.interactivity,
    },
  },
};

export default customer360Trigger;
