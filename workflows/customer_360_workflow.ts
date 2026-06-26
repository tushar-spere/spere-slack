import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { Customer360ControllerDefinition } from "../functions/customer_360_controller.ts";

export const Customer360Workflow = DefineWorkflow({
  callback_id: "customer_360_workflow",
  title: "Customer 360",
  description: "Launch the Executive Customer 360 Command Center",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
});

Customer360Workflow.addStep(Customer360ControllerDefinition, {
  interactivity: Customer360Workflow.inputs.interactivity,
});

export default Customer360Workflow;
