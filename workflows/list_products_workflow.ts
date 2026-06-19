import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { ListProductsFunctionDefinition } from "../functions/list_products.ts";

export const ListProductsWorkflow = DefineWorkflow({
  callback_id: "list_products_workflow",
  title: "View Product Catalog",
  description: "Fetches and displays the available products in the channel.",
  input_parameters: {
    properties: {
      channel: { type: Schema.slack.types.channel_id },
    },
    required: ["channel"],
  },
});

/**
 * EXECUTION STEP
 * We pass the channel straight to our custom function.
 */
ListProductsWorkflow.addStep(ListProductsFunctionDefinition, {
  channel_id: ListProductsWorkflow.inputs.channel,
});
