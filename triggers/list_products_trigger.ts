import { Trigger } from "deno-slack-api/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { ListProductsWorkflow } from "../workflows/list_products_workflow.ts";

/**
 * THE ENTRY POINT
 * A Shortcut trigger that anyone can click to view the catalog.
 */
const listProductsTrigger: Trigger<typeof ListProductsWorkflow.definition> = {
  type: TriggerTypes.Shortcut,
  name: "View Product Catalog",
  description:
    "Fetches and displays the current list of available products in this channel",
  workflow: `#/workflows/${ListProductsWorkflow.definition.callback_id}`,
  inputs: {
    // We capture the channel ID where the user clicked the link and feed it to the workflow
    channel: {
      value: TriggerContextData.Shortcut.channel_id,
    },
  },
};

export default listProductsTrigger;
