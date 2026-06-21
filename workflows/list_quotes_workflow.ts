import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { ListQuotesFunctionDefinition } from "../functions/list_quotes.ts";

export const ListQuotesWorkflow = DefineWorkflow({
  callback_id: "list_quotes_workflow",
  title: "View Quote Database",
  description: "Post a data table of all quotes to the channel",
  input_parameters: {
    properties: {
      interactivity: { type: Schema.slack.types.interactivity },
      channel: { type: Schema.slack.types.channel_id },
    },
    required: ["interactivity", "channel"],
  },
});

ListQuotesWorkflow.addStep(ListQuotesFunctionDefinition, {
  channel_id: ListQuotesWorkflow.inputs.channel,
});

export default ListQuotesWorkflow;
