import { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { ListQuotesWorkflow } from "../workflows/list_quotes_workflow.ts";

const listQuotesTrigger: Trigger<typeof ListQuotesWorkflow.definition> = {
  type: TriggerTypes.Shortcut,
  name: "View Quote Database",
  description: "See a table of all generated quotes",
  workflow: "#/workflows/list_quotes_workflow",
  inputs: {
    interactivity: { value: TriggerContextData.Shortcut.interactivity },
    channel: { value: TriggerContextData.Shortcut.channel_id },
  },
};

export default listQuotesTrigger;
