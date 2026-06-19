import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { ProductsDatastore } from "../datastores/products.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const OpenDynamicModalDefinition = DefineFunction({
  callback_id: "open_dynamic_modal_function",
  title: "Open Dynamic Modal",
  description: "Dynamically generates a UI based on tenant configuration",
  source_file: "functions/open_dynamic_modal.ts",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

// THE FIX: We pass the entire 'field' object here so we can access its saved dropdown_options
function buildDynamicElement(field: any, actionId: string) {
  switch (field.type) {
    case "plain_text_input_multi":
      return { type: "plain_text_input", action_id: actionId, multiline: true };
    case "datepicker":
      return { type: "datepicker", action_id: actionId };
    case "timepicker":
      return { type: "timepicker", action_id: actionId };
    case "multi_users_select":
      return { type: "multi_users_select", action_id: actionId };

    // THE FIX: Handling our new Dropdowns and Checkboxes
    case "static_select":
    case "multi_static_select": {
      // 1. Grab the saved choices array, or use a default if it's empty
      const rawOptions =
        (field.dropdown_options && field.dropdown_options.length > 0)
          ? field.dropdown_options
          : ["No Options Configured"];

      // 2. Map them into Slack's strict JSON format
      const blockKitOptions = rawOptions.map((opt: string) => {
        return {
          text: { type: "plain_text", text: String(opt).substring(0, 75) }, // Slack limit is 75 chars
          value: String(opt).substring(0, 75),
        };
      });

      return {
        type: field.type,
        action_id: actionId,
        placeholder: { type: "plain_text", text: "Select an option..." },
        options: blockKitOptions,
      };
    }

    case "plain_text_input":
    default:
      return { type: "plain_text_input", action_id: actionId };
  }
}

export default SlackFunction(
  OpenDynamicModalDefinition,
  async ({ inputs, client }) => {
    const getResponse = await client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "v4_final_config",
    });

    const tenantConfig: any[] =
      (getResponse.ok && getResponse.item?.custom_fields)
        ? getResponse.item.custom_fields
        : [];

    const dynamicBlocks: any[] = [
      {
        type: "input",
        block_id: "product_id_block",
        element: { type: "plain_text_input", action_id: "id_input" },
        label: { type: "plain_text", text: "Product ID" },
      },
      {
        type: "input",
        block_id: "product_name_block",
        element: { type: "plain_text_input", action_id: "name_input" },
        label: { type: "plain_text", text: "Product Name" },
      },
    ];

    if (tenantConfig.length > 0) {
      tenantConfig.forEach((field, index) => {
        if (field.show_on_form === true) {
          const safeName = (field.name && String(field.name).trim() !== "")
            ? String(field.name)
            : `Custom Field ${index + 1}`;
          const isOptional = field.required !== true;
          const actionId = `custom_action_${index}`;

          dynamicBlocks.push({
            type: "input",
            block_id: `custom_field_${index}`,
            optional: isOptional,
            element: buildDynamicElement(field, actionId), // Passing the whole field!
            label: { type: "plain_text", text: safeName },
          });
        }
      });
    }

    const viewResponse = await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: {
        type: "modal",
        callback_id: "dynamic_product_modal",
        title: { type: "plain_text", text: "Create Product" },
        submit: { type: "plain_text", text: "Save" },
        blocks: dynamicBlocks,
      },
    });

    if (!viewResponse.ok) {
      return { error: `Failed to open modal: ${viewResponse.error}` };
    }
    return { completed: false };
  },
)
  .addViewSubmissionHandler(
    ["dynamic_product_modal"],
    async ({ view, client }) => {
      const values = view.state.values;
      const productId = values.product_id_block.id_input.value;
      const productName = values.product_name_block.name_input.value;

      const metadataBlob: Record<string, any> = {};

      for (const [blockId, actionObj] of Object.entries(values)) {
        if (blockId.startsWith("custom_field_")) {
          const actionId = Object.keys(actionObj as object)[0];
          const actionData = (actionObj as any)[actionId];

          // THE FIX: Check for the new dropdown payloads so we can safely save them!
          let typedValue = null;

          if (actionData.value) {
            typedValue = actionData.value; // Text blocks
          } else if (actionData.selected_date) {
            typedValue = actionData.selected_date; // Date picker
          } else if (actionData.selected_time) {
            typedValue = actionData.selected_time; // Time picker
          } else if (actionData.selected_users) {
            typedValue = actionData.selected_users.join(", "); // Multi User select
          } else if (actionData.selected_option) {
            typedValue = actionData.selected_option.value; // Dropdown (Static Select)
          } else if (actionData.selected_options) {
            // Checkboxes (Multi Static Select) gives us an array of objects
            typedValue = actionData.selected_options.map((o: any) => o.value)
              .join(", ");
          }

          if (typedValue && typedValue.length !== 0) {
            metadataBlob[blockId] = typedValue;
          }
        }
      }

      const putResponse = await client.apps.datastore.put({
        datastore: ProductsDatastore.name,
        item: {
          id: productId,
          name: productName,
          description: "Dynamically created product",
          metadata: JSON.stringify(metadataBlob),
        },
      });

      if (!putResponse.ok) {
        return { error: `Database Save Failed: ${putResponse.error}` };
      }
      return { response_action: "clear" };
    },
  );
