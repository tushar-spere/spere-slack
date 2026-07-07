import { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import { CreateAccountWorkflow } from "../workflows/create_account_workflow.ts";

const createAccountTrigger: Trigger<typeof CreateAccountWorkflow.definition> = {
  type: TriggerTypes.Shortcut,
  name: "Account",
  description: "Launch the Account Creation dossier",
  workflow: `#/workflows/${CreateAccountWorkflow.definition.callback_id}`,
  inputs: {
    interactivity: {
      value: TriggerContextData.Shortcut.interactivity,
    },
  },
};

export default createAccountTrigger;
