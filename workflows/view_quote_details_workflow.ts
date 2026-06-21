import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { ViewQuoteDetailsFunctionDefinition } from "../functions/view_quote_details.ts";

export const ViewQuoteDetailsWorkflow = DefineWorkflow({
  callback_id: "view_quote_details_workflow",
  title: "Search & View Quotes",
  description: "Open the interactive quote search modal",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
});

ViewQuoteDetailsWorkflow.addStep(ViewQuoteDetailsFunctionDefinition, {
  interactivity: ViewQuoteDetailsWorkflow.inputs.interactivity,
});

export default ViewQuoteDetailsWorkflow;
