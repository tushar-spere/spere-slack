import { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { ViewQuoteDetailsWorkflow } from "../workflows/view_quote_details_workflow.ts";

const viewQuoteDetailsTrigger: Trigger<
  typeof ViewQuoteDetailsWorkflow.definition
> = {
  type: TriggerTypes.Shortcut,
  name: "Search & View Quotes",
  description: "Look up a specific quote's details",
  workflow: "#/workflows/view_quote_details_workflow",
  inputs: {
    interactivity: { value: TriggerContextData.Shortcut.interactivity },
  },
};

export default viewQuoteDetailsTrigger;
