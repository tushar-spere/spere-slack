import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { OpenDynamicModalDefinition } from "../functions/open_dynamic_modal.ts";

export const AddProductWorkflow = DefineWorkflow({
  callback_id: "add_product_workflow",
  title: "Add New Product",
  description: "Opens a dynamic form to add a product to the catalog.",
  input_parameters: {
    properties: {
      interactivity: { type: Schema.slack.types.interactivity },
      channel: { type: Schema.slack.types.channel_id },
    },
    required: ["interactivity", "channel"],
  },
});

/**
 * THE DYNAMIC HANDOFF
 * We pass the required interactivity token straight to our custom function.
 * The function handles the UI, the Database Save, and closing the modal.
 */
AddProductWorkflow.addStep(OpenDynamicModalDefinition, {
  interactivity: AddProductWorkflow.inputs.interactivity,
});
