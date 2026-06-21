import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { OpenDynamicModalDefinition } from "../functions/open_dynamic_modal.ts";

export const AddProductWorkflow = DefineWorkflow({
  callback_id: "add_product_workflow",
  title: "Add a New Product",
  description: "Launch the dynamic product creation form",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
});

AddProductWorkflow.addStep(OpenDynamicModalDefinition, {
  interactivity: AddProductWorkflow.inputs.interactivity,
  schema_id: "v4_final_config", // TELLS THE ENGINE TO DRAW THE PRODUCT FORM
});

export default AddProductWorkflow;
