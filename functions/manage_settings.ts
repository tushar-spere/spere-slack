import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const ManageSettingsFunctionDefinition = DefineFunction({
  callback_id: "manage_settings_function",
  title: "Manage App Settings",
  description: "Tabbed dashboard for managing custom fields",
  source_file: "functions/manage_settings.ts",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

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

function getAddBlocks(refreshId: number) {
  return [
    getNavHeader("add"),
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "Add a New Field" } },
    {
      type: "input",
      block_id: `new_name_${refreshId}`,
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "name_input",
        placeholder: { type: "plain_text", text: "e.g., Color, Size, Region" },
      },
      label: { type: "plain_text", text: "Field Name" },
    },
    {
      type: "input",
      block_id: `new_type_${refreshId}`,
      optional: true,
      element: {
        type: "static_select",
        action_id: "type_input",
        placeholder: { type: "plain_text", text: "Select field type" },
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
        placeholder: { type: "plain_text", text: "e.g., Small, Medium, Large" },
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
        text: { type: "plain_text", text: "Add Field" },
        action_id: "add_new_field_btn",
        value: "add",
      }],
    },
  ];
}

async function getManageBlocks(client: any) {
  const getResponse = await client.apps.datastore.get({
    datastore: TenantSettingsDatastore.name,
    id: "v4_final_config",
  });
  const fields: any[] = getResponse.ok && getResponse.item?.custom_fields
    ? getResponse.item.custom_fields
    : [];

  const blocks: any[] = [
    getNavHeader("manage"),
    { type: "divider" },
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
          "_No custom fields configured yet. Switch to the *Add New Field* tab to get started._",
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

      const typeDisplayMap: Record<string, string> = {
        "plain_text_input": "Text",
        "plain_text_input_multi": "Paragraph",
        "datepicker": "Date",
        "timepicker": "Time",
        "multi_users_select": "Users",
        "static_select": "Dropdown",
        "multi_static_select": "Checkboxes",
      };

      let displayType = typeDisplayMap[f.type] || "Text";
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

      // THE FIX: We are now using static action_ids ("move_up" and "move_down")
      // and passing the target row index via the 'value' payload.
      const moveElements = [];
      if (index > 0) {
        moveElements.push({
          type: "button",
          text: { type: "plain_text", text: "⬆️ Move Up" },
          action_id: "move_up",
          value: String(index),
        });
      }
      if (index < fields.length - 1) {
        moveElements.push({
          type: "button",
          text: { type: "plain_text", text: "⬇️ Move Down" },
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
    const viewResponse = await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: {
        type: "modal",
        callback_id: "settings_add_view",
        title: { type: "plain_text", text: "App Settings" },
        submit: { type: "plain_text", text: "Save Changes" },
        blocks: getAddBlocks(refreshId),
      },
    });
    if (!viewResponse.ok) {return {
        error: `Failed to open modal: ${viewResponse.error}`,
      };}
    return { completed: false };
  },
)
  .addBlockActionsHandler(
    ["go_to_add", "go_to_manage"],
    async ({ action, body, client }) => {
      const view_id = body.view?.id;
      if (!view_id) return { completed: false };
      const isAdd = action.action_id === "go_to_add";
      const refreshId = Math.floor(Math.random() * 1_000_000);
      await client.views.update({
        view_id,
        view: {
          type: "modal",
          callback_id: isAdd ? "settings_add_view" : "settings_manage_view",
          title: { type: "plain_text", text: "App Settings" },
          submit: { type: "plain_text", text: "Save Changes" },
          notify_on_close: false,
          blocks: isAdd
            ? getAddBlocks(refreshId)
            : await getManageBlocks(client),
        },
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(["add_new_field_btn"], async ({ body, client }) => {
    const view_id = body.view?.id;
    if (!view_id) return { completed: false };
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
        id: "v4_final_config",
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
        item: { id: "v4_final_config", custom_fields: fields },
      });
    }

    const refreshId = Math.floor(Math.random() * 1_000_000);
    await client.views.update({
      view_id,
      view: {
        type: "modal",
        callback_id: "settings_add_view",
        title: { type: "plain_text", text: "App Settings" },
        submit: { type: "plain_text", text: "Save Changes" },
        blocks: getAddBlocks(refreshId),
      },
    });
    return { completed: false };
  })
  // THE FIX: We are safely routing exact string matches now!
  .addBlockActionsHandler(
    ["move_up", "move_down"],
    async ({ action, body, client }) => {
      const view_id = body.view?.id;
      if (!view_id) return { completed: false };

      const isUp = action.action_id === "move_up";
      const index = parseInt(action.value, 10);

      const getResponse = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "v4_final_config",
      });
      let fields: any[] = getResponse.item?.custom_fields || [];

      // Safely save any dropdown changes the user made before clicking "Move"
      const values = body.view.state.values;
      fields.forEach((f: any, idx: number) => {
        const blockId = `field_settings_${idx}`;
        const actionId = `visibility_action_${idx}`;
        if (values && values[blockId] && values[blockId][actionId]) {
          const selected = values[blockId][actionId].selected_options || [];
          f.show_on_form = selected.some((opt: any) => opt.value === "form");
          f.show_on_table = selected.some((opt: any) => opt.value === "table");
        }
      });

      // Swap the array elements mathematically
      if (isUp && index > 0) {
        [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]];
      } else if (!isUp && index < fields.length - 1) {
        [fields[index], fields[index + 1]] = [fields[index + 1], fields[index]];
      }

      // Save the new sequence
      await client.apps.datastore.put({
        datastore: TenantSettingsDatastore.name,
        item: { id: "v4_final_config", custom_fields: fields },
      });

      // Instantly refresh the view
      await client.views.update({
        view_id,
        view: {
          type: "modal",
          callback_id: "settings_manage_view",
          title: { type: "plain_text", text: "App Settings" },
          submit: { type: "plain_text", text: "Save Changes" },
          notify_on_close: false,
          blocks: await getManageBlocks(client),
        },
      });

      return { completed: false };
    },
  )
  .addBlockActionsHandler([/^visibility_action_.*/], async () => {
    return { completed: false };
  })
  .addViewSubmissionHandler(["settings_add_view"], async ({ view, client }) => {
    const values = view.state.values;
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
        id: "v4_final_config",
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
        item: { id: "v4_final_config", custom_fields: fields },
      });
    }
    return { response_action: "clear" };
  })
  .addViewSubmissionHandler(
    ["settings_manage_view"],
    async ({ view, client }) => {
      const values = view.state.values;
      const getResponse = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "v4_final_config",
      });
      let fields: any[] = getResponse.item?.custom_fields || [];

      fields.forEach((f: any, index: number) => {
        const blockId = `field_settings_${index}`;
        const actionId = `visibility_action_${index}`;
        if (values[blockId]?.[actionId]) {
          const selected = values[blockId][actionId].selected_options || [];
          f.show_on_form = selected.some((opt: any) => opt.value === "form");
          f.show_on_table = selected.some((opt: any) => opt.value === "table");
        }
      });

      await client.apps.datastore.put({
        datastore: TenantSettingsDatastore.name,
        item: { id: "v4_final_config", custom_fields: fields },
      });
      return { response_action: "clear" };
    },
  );
