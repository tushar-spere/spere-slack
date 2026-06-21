import { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { CreateQuoteWorkflow } from "../workflows/create_quote_workflow.ts";

const createQuoteTrigger: Trigger<typeof CreateQuoteWorkflow.definition> = {
  type: TriggerTypes.Shortcut,
  name: "Create a New Quote",
  description: "Generate a new custom quote",
  workflow: "#/workflows/create_quote_workflow",
  inputs: {
    interactivity: {
      value: TriggerContextData.Shortcut.interactivity,
    },
  },
};

export default createQuoteTrigger;
