import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { CreateProductFunctionDefinition } from "../functions/create_product.ts";

/**
 * THE BLUEPRINT
 * This defines the inputs required just to start the workflow.
 */
export const AddProductWorkflow = DefineWorkflow({
  callback_id: "add_product_workflow",
  title: "Add New Product",
  description: "Opens a form to add a product to the catalog.",
  input_parameters: {
    properties: {
      // 'interactivity' is a required Slack token used to open UI modals.
      interactivity: { type: Schema.slack.types.interactivity },
      // 'channel' is where the user invoked the workflow, so we know where to send the confirmation.
      channel: { type: Schema.slack.types.channel_id },
    },
    required: ["interactivity", "channel"],
  },
});

/**
 * STEP 1: Gather Input (Built-in Slack Function)
 * We use Slack's native OpenForm function to generate the Block Kit UI.
 */
const inputForm = AddProductWorkflow.addStep(
  Schema.slack.functions.OpenForm,
  {
    title: "Create Product",
    interactivity: AddProductWorkflow.inputs.interactivity,
    submit_label: "Save Product",
    fields: {
      elements: [
        {
          name: "id",
          title: "Product ID (e.g., PRD-001)",
          type: Schema.types.string,
        },
        {
          name: "name",
          title: "Product Name",
          type: Schema.types.string,
        },
        {
          name: "description",
          title: "Description",
          type: Schema.types.string,
          long: true, // Renders as a multi-line text area instead of a single line
        },
      ],
      required: ["id", "name", "description"],
    },
  },
);

/**
 * STEP 2: Execute Logic (Our Custom Function)
 * We pass the exact outputs from the form directly into your custom function.
 */
AddProductWorkflow.addStep(CreateProductFunctionDefinition, {
  id: inputForm.outputs.fields.id,
  name: inputForm.outputs.fields.name,
  description: inputForm.outputs.fields.description,
});

/**
 * STEP 3: Notify Success (Built-in Slack Function)
 * Send a confirmation message to the channel where the workflow started.
 */
AddProductWorkflow.addStep(Schema.slack.functions.SendMessage, {
  channel_id: AddProductWorkflow.inputs.channel,
  message:
    `✅ Product *${inputForm.outputs.fields.name}* (ID: ${inputForm.outputs.fields.id}) has been securely added to the catalog.`,
});
