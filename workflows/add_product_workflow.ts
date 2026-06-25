import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { ProductControllerDefinition } from "../functions/product_controller.ts";

export const AddProductWorkflow = DefineWorkflow({
  callback_id: "add_product_workflow",
  title: "Add a New Product",
  description: "Launch the dynamic product creation form",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
});

AddProductWorkflow.addStep(ProductControllerDefinition, {
  interactivity: AddProductWorkflow.inputs.interactivity,
  // Notice: schema_id is gone. The controller natively targets v4_final_config.
});

export default AddProductWorkflow;