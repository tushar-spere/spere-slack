import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { QuoteControllerDefinition } from "../functions/quote_controller.ts";
import { PostQuoteCardFunction } from "../functions/post_quote_card.ts";

export const CreateQuoteWorkflow = DefineWorkflow({
  callback_id: "create_quote_workflow",
  title: "Create a New Quote",
  description: "Launch the dynamic quote generation form",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
});

// Capture the step so we can reference its outputs downstream
const formStep = CreateQuoteWorkflow.addStep(QuoteControllerDefinition, {
  interactivity: CreateQuoteWorkflow.inputs.interactivity,
  // Notice: schema_id is gone. The controller natively targets schema_quote.
});

// Chain the Card Generator directly to the form's completion
CreateQuoteWorkflow.addStep(PostQuoteCardFunction, {
  quote_id: formStep.outputs.quote_id,
  customer_name: formStep.outputs.customer_name,
  total_amount: formStep.outputs.total_amount,
  sales_rep_id: CreateQuoteWorkflow.inputs.interactivity.interactor.id,
  // COMPLETELY DECOUPLED: No channel IDs here!
});

export default CreateQuoteWorkflow;