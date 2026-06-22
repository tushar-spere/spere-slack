import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const TenantSettingsDatastore = DefineDatastore({
  name: "tenant_settings",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    broadcast_channels: { type: Schema.types.string },
    custom_fields: {
      type: Schema.types.array,
      items: {
        type: Schema.types.object,
        properties: {
          name: { type: Schema.types.string },
          type: { type: Schema.types.string },
          required: { type: Schema.types.boolean },
          show_on_form: { type: Schema.types.boolean },
          show_on_table: { type: Schema.types.boolean },
          dropdown_options: {
            type: Schema.types.array,
            items: { type: Schema.types.string },
          },
        },
      },
    },
    // ADVANCED APPROVAL RULES STORAGE:
    // Stored as a serialized JSON string to safely prevent exceeding the SDK's nested object depth limits
    approval_rules: { type: Schema.types.string },
  },
});
