import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { AccountControllerDefinition } from "../functions/account_controller.ts";

export const CreateAccountWorkflow = DefineWorkflow({
  callback_id: "create_account_workflow",
  title: "Create an Account",
  description: "Launch the dynamic Account Creation dossier",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
});

CreateAccountWorkflow.addStep(AccountControllerDefinition, {
  interactivity: CreateAccountWorkflow.inputs.interactivity,
});

export default CreateAccountWorkflow;