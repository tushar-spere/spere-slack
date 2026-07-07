import { Trigger } from "deno-slack-api/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { AddProductWorkflow } from "../workflows/add_product_workflow.ts";

/**
 * THE ENTRY POINT
 * This configures how the user kicks off the workflow.
 * We use a Shortcut (Link) trigger type.
 */
const addProductTrigger: Trigger<typeof AddProductWorkflow.definition> = {
  type: TriggerTypes.Shortcut,
  name: "Product",
  description:
    "Starts the workflow to add a new product to the database catalog",
  workflow: `#/workflows/${AddProductWorkflow.definition.callback_id}`,
  inputs: {
    // We map Slack's runtime contextual data directly into our Workflow parameters
    interactivity: {
      value: TriggerContextData.Shortcut.interactivity,
    },
    channel: {
      value: TriggerContextData.Shortcut.channel_id,
    },
  },
};

export default addProductTrigger;
