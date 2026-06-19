import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const AddCustomFieldDefinition = DefineFunction({
  callback_id: "add_custom_field_function",
  title: "Add Custom Field to Settings",
  description: "Appends a new custom field to the tenant configuration",
  source_file: "functions/add_custom_field.ts",
  input_parameters: {
    properties: {
      field_name: {
        type: Schema.types.string,
        description: "Name of the custom field",
      },
      is_required: {
        type: Schema.types.boolean,
        description: "Is this field mandatory?",
      },
    },
    required: ["field_name", "is_required"],
  },
  output_parameters: { properties: {}, required: [] },
});

export default SlackFunction(
  AddCustomFieldDefinition,
  async ({ inputs, client }) => {
    const configId = "v3_final_config"; // The static row where we store settings

    // 1. Fetch existing settings (if they exist)
    const getResponse = await client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: configId,
    });

    // Default to an empty array if this is the very first time running it
    let currentFields: any[] = [];
    if (getResponse.ok && getResponse.item && getResponse.item.custom_fields) {
      currentFields = getResponse.item.custom_fields;
    }

    // 2. Append the new field exactly how our Dynamic Modal expects it
    currentFields.push({
      name: inputs.field_name,
      type: "plain_text_input", // We default to text inputs for this architecture
      required: inputs.is_required,
    });

    // 3. Save the updated array back to the database
    const putResponse = await client.apps.datastore.put({
      datastore: TenantSettingsDatastore.name,
      item: {
        id: configId,
        custom_fields: currentFields,
      },
    });

    if (!putResponse.ok) {
      return { error: `Failed to save new setting: ${putResponse.error}` };
    }

    return { outputs: {} };
  },
);
