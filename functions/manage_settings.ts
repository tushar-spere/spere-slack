import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const ManageSettingsFunctionDefinition = DefineFunction({
  callback_id: "manage_settings_function",
  title: "Manage App Settings",
  description:
    "Tabbed dashboard for managing custom fields across all 3 enterprise objects",
  source_file: "functions/manage_settings.ts",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

// ARCHITECTURE: The Expanded 3-Object Master Selector
function getSchemaSelector(schemaId: string) {
  let readableTitle = "📦 Catalog Product Object";
  if (schemaId === "schema_quote") readableTitle = "📄 Quote Master Object";
  if (schemaId === "schema_quote_product") {
    readableTitle = "📑 Quote Line Item Object";
  }

  return {
    type: "section",
    block_id: "schema_selector_block",
    text: { type: "mrkdwn", text: "*Select Enterprise Object to Configure:*" },
    accessory: {
      type: "static_select",
      action_id: "select_schema_action",
      initial_option: {
        text: { type: "plain_text", text: readableTitle },
        value: schemaId,
      },
      options: [
        {
          text: { type: "plain_text", text: "📦 Catalog Product Object" },
          value: "v4_final_config",
        },
        {
          text: { type: "plain_text", text: "📄 Quote Master Object" },
          value: "schema_quote",
        },
        {
          text: { type: "plain_text", text: "📑 Quote Line Item Object" },
          value: "schema_quote_product",
        },
      ],
    },
  };
}

function getNavHeader(activeView: "add" | "manage") {
  return {
    type: "actions",
    block_id: "nav_header",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "➕  Add New Field" },
        action_id: "go_to_add",
        value: "add",
        style: activeView === "add" ? "primary" : undefined,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "⚙️  Manage Fields" },
        action_id: "go_to_manage",
        value: "manage",
        style: activeView === "manage" ? "primary" : undefined,
      },
    ],
  };
}

async function getBroadcastSection(client: any, schemaId: string) {
  if (schemaId !== "schema_quote") return [];

  const getResponse = await client.apps.datastore.get({
    datastore: TenantSettingsDatastore.name,
    id: schemaId,
  });

  let initialRooms: string[] = [];
  if (getResponse.ok && getResponse.item?.broadcast_channels) {
    try {
      initialRooms = JSON.parse(getResponse.item.broadcast_channels);
    } catch (e) {
      console.error("Failed to parse broadcast rooms JSON", e);
    }
  }

  const selectElement: any = {
    type: "multi_channels_select",
    action_id: "broadcast_channels_action",
    placeholder: {
      type: "plain_text",
      text: "Select target broadcast rooms...",
    },
  };

  if (initialRooms.length > 0) selectElement.initial_channels = initialRooms;

  return [
    {
      type: "input",
      block_id: "broadcast_channels_block",
      optional: true,
      element: selectElement,
      label: {
        type: "plain_text",
        text: "📢 Broadcast Channels for Finalized Quotes",
      },
    },
    { type: "divider" },
  ];
}

async function getAddBlocks(client: any, refreshId: number, schemaId: string) {
  const broadcastBlocks = await getBroadcastSection(client, schemaId);

  return [
    getSchemaSelector(schemaId),
    { type: "divider" },
    getNavHeader("add"),
    { type: "divider" },
    ...broadcastBlocks,
    {
      type: "header",
      text: { type: "plain_text", text: "Add a New Custom Field" },
    },
    {
      type: "input",
      block_id: `new_name_${refreshId}`,
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "name_input",
        placeholder: {
          type: "plain_text",
          text: "e.g., Discount (%), Delivery Tier",
        },
      },
      label: { type: "plain_text", text: "Field Label" },
    },
    {
      type: "input",
      block_id: `new_type_${refreshId}`,
      optional: true,
      element: {
        type: "static_select",
        action_id: "type_input",
        placeholder: { type: "plain_text", text: "Select data type" },
        initial_option: {
          text: { type: "plain_text", text: "Short Text" },
          value: "plain_text_input",
        },
        options: [
          {
            text: { type: "plain_text", text: "Short Text" },
            value: "plain_text_input",
          },
          {
            text: { type: "plain_text", text: "Paragraph (Multi-line)" },
            value: "plain_text_input_multi",
          },
          {
            text: { type: "plain_text", text: "Date Picker" },
            value: "datepicker",
          },
          {
            text: { type: "plain_text", text: "Time Picker" },
            value: "timepicker",
          },
          {
            text: { type: "plain_text", text: "User Select" },
            value: "multi_users_select",
          },
          {
            text: { type: "plain_text", text: "Dropdown (Select One)" },
            value: "static_select",
          },
          {
            text: { type: "plain_text", text: "Checkboxes (Select Multiple)" },
            value: "multi_static_select",
          },
        ],
      },
      label: { type: "plain_text", text: "Data Type" },
    },
    {
      type: "input",
      block_id: `new_options_${refreshId}`,
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "options_input",
        placeholder: { type: "plain_text", text: "e.g., 10%, 20%, Custom" },
      },
      label: {
        type: "plain_text",
        text: "Choices (For Dropdowns & Checkboxes)",
      },
    },
    {
      type: "input",
      block_id: `new_req_${refreshId}`,
      optional: true,
      // THE ROOT CAUSE FIX: Perfectly structured checkboxes object without the syntax corruption
      element: {
        type: "checkboxes",
        action_id: "req_input",
        options: [{
          text: { type: "plain_text", text: "Make this field mandatory" },
          value: "true",
        }],
      },
      label: { type: "plain_text", text: "Requirements" },
    },
    {
      type: "actions",
      block_id: "add_field_actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "Commit Field to Schema" },
        action_id: "add_new_field_btn",
        style: "primary",
        value: "add",
      }],
    },
  ];
}

async function getManageBlocks(client: any, schemaId: string) {
  const getResponse = await client.apps.datastore.get({
    datastore: TenantSettingsDatastore.name,
    id: schemaId,
  });
  const fields: any[] = getResponse.ok && getResponse.item?.custom_fields
    ? getResponse.item.custom_fields
    : [];
  const broadcastBlocks = await getBroadcastSection(client, schemaId);

  const blocks: any[] = [
    getSchemaSelector(schemaId),
    { type: "divider" },
    getNavHeader("manage"),
    { type: "divider" },
    ...broadcastBlocks,
    {
      type: "header",
      text: { type: "plain_text", text: "Manage Custom Fields" },
    },
  ];

  if (fields.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "_No custom fields configured for this object yet. Switch to the *Add New Field* tab to get started._",
      },
    });
  } else {
    fields.forEach((f: any, index: number) => {
      const formOption = {
        text: { type: "plain_text", text: "Create Form" },
        value: "form",
      };
      const tableOption = {
        text: { type: "plain_text", text: "Data Table" },
        value: "table",
      };

      // THE VISIBILITY FIX: Restored dynamic computation so user settings map accurately
      const initialOptions: any[] = [];
      if (f.show_on_form) initialOptions.push(formOption);
      if (f.show_on_table) initialOptions.push(tableOption);

      const selectElement: any = {
        type: "multi_static_select",
        placeholder: { type: "plain_text", text: "Select Visibility" },
        action_id: `visibility_action_${index}`,
        options: [formOption, tableOption],
      };

      if (initialOptions.length > 0) {
        selectElement.initial_options = initialOptions;
      }

      let displayType = f.type;
      if (f.dropdown_options && f.dropdown_options.length > 0) {
        displayType += ` (${f.dropdown_options.join(", ")})`;
      }

      blocks.push({
        type: "section",
        block_id: `field_settings_${index}`,
        text: {
          type: "mrkdwn",
          text: `*${f.name}* [${displayType}] — ${
            f.required ? "required" : "optional"
          }`,
        },
        accessory: selectElement,
      });

      const moveElements = [];
      if (index > 0) {
        moveElements.push({
          type: "button",
          text: { type: "plain_text", text: "⬆️ Up" },
          action_id: "move_up",
          value: String(index),
        });
      }
      if (index < fields.length - 1) {
        moveElements.push({
          type: "button",
          text: { type: "plain_text", text: "⬇️ Down" },
          action_id: "move_down",
          value: String(index),
        });
      }

      if (moveElements.length > 0) {
        blocks.push({
          type: "actions",
          block_id: `move_actions_${index}`,
          elements: moveElements,
        });
      }
      blocks.push({ type: "divider" });
    });
  }
  return blocks;
}

export default SlackFunction(
  ManageSettingsFunctionDefinition,
  async ({ inputs, client }) => {
    const refreshId = Math.floor(Math.random() * 1_000_000);
    const currentSchemaId = "v4_final_config";

    const viewResponse = await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: {
        type: "modal",
        callback_id: "settings_add_view",
        private_metadata: currentSchemaId,
        title: { type: "plain_text", text: "Enterprise Setup" },
        submit: { type: "plain_text", text: "Save Configuration" },
        blocks: await getAddBlocks(client, refreshId, currentSchemaId),
      },
    });
    if (!viewResponse.ok) {return {
        error: `Failed to open setup modal: ${viewResponse.error}`,
      };}
    return { completed: false };
  },
)
  .addBlockActionsHandler(
    ["select_schema_action"],
    async ({ action, body, client }) => {
      const view_id = body.view?.id;
      const isAddView = body.view?.callback_id === "settings_add_view";
      if (!view_id) return { completed: false };

      const newSchemaId = action.selected_option.value;
      const refreshId = Math.floor(Math.random() * 1_000_000);

      await client.views.update({
        view_id,
        view: {
          type: "modal",
          callback_id: isAddView ? "settings_add_view" : "settings_manage_view",
          private_metadata: newSchemaId,
          title: { type: "plain_text", text: "Enterprise Setup" },
          submit: { type: "plain_text", text: "Save Configuration" },
          notify_on_close: false,
          blocks: isAddView
            ? await getAddBlocks(client, refreshId, newSchemaId)
            : await getManageBlocks(client, newSchemaId),
        },
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["go_to_add", "go_to_manage"],
    async ({ action, body, client }) => {
      const view_id = body.view?.id;
      if (!view_id) return { completed: false };

      const currentSchemaId = body.view.private_metadata || "v4_final_config";
      const isAdd = action.action_id === "go_to_add";
      const refreshId = Math.floor(Math.random() * 1_000_000);

      await client.views.update({
        view_id,
        view: {
          type: "modal",
          callback_id: isAdd ? "settings_add_view" : "settings_manage_view",
          private_metadata: currentSchemaId,
          title: { type: "plain_text", text: "Enterprise Setup" },
          submit: { type: "plain_text", text: "Save Configuration" },
          notify_on_close: false,
          blocks: isAdd
            ? await getAddBlocks(client, refreshId, currentSchemaId)
            : await getManageBlocks(client, currentSchemaId),
        },
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(["add_new_field_btn"], async ({ body, client }) => {
    const view_id = body.view?.id;
    if (!view_id) return { completed: false };

    const currentSchemaId = body.view.private_metadata || "v4_final_config";
    const values = body.view.state.values;

    let newFieldName = "";
    let newFieldType = "plain_text_input";
    let newOptionsStr = "";
    let isRequired = false;

    for (const blockId of Object.keys(values)) {
      if (blockId.startsWith("new_name_")) {
        newFieldName = values[blockId].name_input?.value ?? "";
      }
      if (blockId.startsWith("new_type_")) {
        newFieldType = values[blockId].type_input?.selected_option?.value ??
          "plain_text_input";
      }
      if (blockId.startsWith("new_options_")) {
        newOptionsStr = values[blockId].options_input?.value ?? "";
      }
      if (blockId.startsWith("new_req_")) {
        isRequired =
          (values[blockId].req_input?.selected_options?.length ?? 0) > 0;
      }
    }

    if (newFieldName.trim() !== "") {
      const getResponse = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: currentSchemaId,
      });
      const fields: any[] = getResponse.item?.custom_fields || [];
      let dropdownOptions: string[] = [];
      if (newOptionsStr.trim() !== "") {
        dropdownOptions = newOptionsStr.split(",").map((s) =>
          s.trim()
        ).filter((s) => s !== "");
      }

      fields.push({
        name: newFieldName.trim(),
        type: newFieldType,
        required: isRequired,
        show_on_form: true,
        show_on_table: true,
        dropdown_options: dropdownOptions,
      });

      await client.apps.datastore.put({
        datastore: TenantSettingsDatastore.name,
        item: {
          id: currentSchemaId,
          custom_fields: fields,
          broadcast_channels: getResponse.item?.broadcast_channels,
        },
      });
    }

    const refreshId = Math.floor(Math.random() * 1_000_000);
    await client.views.update({
      view_id,
      view: {
        type: "modal",
        callback_id: "settings_add_view",
        private_metadata: currentSchemaId,
        title: { type: "plain_text", text: "Enterprise Setup" },
        submit: { type: "plain_text", text: "Save Configuration" },
        blocks: await getAddBlocks(client, refreshId, currentSchemaId),
      },
    });
    return { completed: false };
  })
  .addBlockActionsHandler(
    ["move_up", "move_down"],
    async ({ action, body, client }) => {
      const view_id = body.view?.id;
      if (!view_id) return { completed: false };

      const currentSchemaId = body.view.private_metadata || "v4_final_config";
      const isUp = action.action_id === "move_up";
      const index = parseInt(action.value, 10);

      const getResponse = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: currentSchemaId,
      });
      const fields: any[] = getResponse.item?.custom_fields || [];
      if (isUp && index > 0) {[fields[index - 1], fields[index]] = [
          fields[index],
          fields[index - 1],
        ];} else if (!isUp && index < fields.length - 1) {[
          fields[index],
          fields[index + 1],
        ] = [fields[index + 1], fields[index]];}

      await client.apps.datastore.put({
        datastore: TenantSettingsDatastore.name,
        item: {
          id: currentSchemaId,
          custom_fields: fields,
          broadcast_channels: getResponse.item?.broadcast_channels,
        },
      });
      await client.views.update({
        view_id,
        view: {
          type: "modal",
          callback_id: "settings_manage_view",
          private_metadata: currentSchemaId,
          title: { type: "plain_text", text: "Enterprise Setup" },
          submit: { type: "plain_text", text: "Save Configuration" },
          notify_on_close: false,
          blocks: await getManageBlocks(client, currentSchemaId),
        },
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler([
    /^visibility_action_.*/,
    "broadcast_channels_action",
  ], async () => ({ completed: false }))
  .addViewSubmissionHandler(
    ["settings_add_view", "settings_manage_view"],
    async ({ view, client }) => {
      const currentSchemaId = view.private_metadata || "v4_final_config";
      const values = view.state.values;

      const getResponse = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: currentSchemaId,
      });
      const fields: any[] = getResponse.item?.custom_fields || [];
      let broadcastRoomsStr = getResponse.item?.broadcast_channels;

      const selectedRoomsArray = values.broadcast_channels_block
        ?.broadcast_channels_action?.selected_channels;
      if (selectedRoomsArray) {broadcastRoomsStr = JSON.stringify(
          selectedRoomsArray,
        );}

      await client.apps.datastore.put({
        datastore: TenantSettingsDatastore.name,
        item: {
          id: currentSchemaId,
          custom_fields: fields,
          broadcast_channels: broadcastRoomsStr,
        },
      });
      return { response_action: "clear" };
    },
  );
