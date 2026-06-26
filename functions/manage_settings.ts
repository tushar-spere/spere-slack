import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const ManageSettingsFunctionDefinition = DefineFunction({
  callback_id: "manage_settings_function",
  title: "Manage App Settings",
  description: "Enterprise dashboard for rich custom fields and advanced approval routing",
  source_file: "functions/manage_settings.ts",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

async function autoSaveTabState(body: any, client: any) {
  const curId = body.view?.private_metadata || "v4_final_config";
  // 🎯 WIDENED GATE: Allow auto-saving channels for Accounts
  if (curId !== "schema_quote" && curId !== "v4_final_config" && curId !== "schema_account") return;
  
  const stateVals = body.view?.state?.values;
  if (!stateVals) return;
  
  const blockId = "broadcast_channels_block_" + curId;
  const actionObj = stateVals[blockId]?.["broadcast_channels_action"];
  
  if (actionObj) {
    const finalChannels = JSON.stringify(actionObj.selected_channels || []);
    const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: curId });
    await client.apps.datastore.put({
      datastore: TenantSettingsDatastore.name,
      item: {
        id: curId,
        custom_fields: res.item?.custom_fields || [],
        broadcast_channels: finalChannels,
        approval_rules: res.item?.approval_rules,
      }
    });
  }
}

function getSafeChannelsFromState(stateVals: any, schemaId: string, fallbackDbString: any) {
  if (!stateVals) return fallbackDbString;
  const blockId = "broadcast_channels_block_" + schemaId;
  const actionObj = stateVals[blockId]?.["broadcast_channels_action"];
  if (actionObj) return JSON.stringify(actionObj.selected_channels || []);
  return fallbackDbString;
}

function getSchemaSelector(activeTabId: string) {
  let title = "Product";
  if (activeTabId === "schema_quote") title = "Quote";
  if (activeTabId === "schema_quote_product") title = "Quote Product";
  if (activeTabId === "advanced_approval_rules") title = "Quote Approvals";
  if (activeTabId === "schema_account") title = "Account"; // 🎯 NEW SCHEMA

  return {
    type: "section",
    block_id: "schema_selector_block",
    text: { type: "mrkdwn", text: "*Select Administration Portal:*" },
    accessory: {
      type: "static_select",
      action_id: "select_schema_action",
      placeholder: { type: "plain_text", text: "Select portal..." },
      initial_option: { text: { type: "plain_text", text: title }, value: activeTabId },
      options: [
        { text: { type: "plain_text", text: "Account" }, value: "schema_account" }, // 🎯 Added to top of list
        { text: { type: "plain_text", text: "Product" }, value: "v4_final_config" },
        { text: { type: "plain_text", text: "Quote" }, value: "schema_quote" },
        { text: { type: "plain_text", text: "Quote Product" }, value: "schema_quote_product" },
        { text: { type: "plain_text", text: "Quote Approvals" }, value: "advanced_approval_rules" },
      ],
    },
  };
}

function getNavHeader(activeView: "add" | "manage") {
  return {
    type: "actions",
    block_id: "nav_header",
    elements: [
      { type: "button", text: { type: "plain_text", text: "New" }, action_id: "go_to_add", value: "add", style: activeView === "add" ? "primary" : undefined },
      { type: "button", text: { type: "plain_text", text: "Manage" }, action_id: "go_to_manage", value: "manage", style: activeView === "manage" ? "primary" : undefined },
    ],
  };
}

async function getBroadcastSection(client: any, schemaId: string) {
  // 🎯 WIDENED GATE: Allow broadcast channels for Accounts
  if (schemaId !== "schema_quote" && schemaId !== "v4_final_config" && schemaId !== "schema_account") return [];
  const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: schemaId });
  let initialRooms: string[] = [];
  if (res.ok && res.item?.broadcast_channels) {
    try { initialRooms = JSON.parse(res.item.broadcast_channels); } catch (e) { /**/ }
  }

  const selectElement: any = { type: "multi_channels_select", action_id: "broadcast_channels_action", placeholder: { type: "plain_text", text: "Select target broadcast rooms..." } };
  if (initialRooms.length > 0) selectElement.initial_channels = initialRooms;

  return [
    { type: "input", block_id: "broadcast_channels_block_" + schemaId, optional: true, element: selectElement, label: { type: "plain_text", text: "Announce / Broadcast Channels" } },
    { type: "divider" },
  ];
}

async function getAddCustomFieldBlocks(client: any, refreshId: number, schemaId: string) {
  const broadcastBlocks = await getBroadcastSection(client, schemaId);
  const isQuoteProductFlow = schemaId === "schema_quote_product";

  const blocks: any[] = [
    getSchemaSelector(schemaId), { type: "divider" },
    getNavHeader("add"), { type: "divider" },
    ...broadcastBlocks,
    { type: "header", text: { type: "plain_text", text: "Add a New Custom Field" } },
    { type: "input", block_id: "new_name_" + refreshId, optional: true, element: { type: "plain_text_input", action_id: "name_input", placeholder: { type: "plain_text", text: "e.g., Discount (%), Delivery Tier" } }, label: { type: "plain_text", text: "Field Label" } },
    { type: "input", block_id: "new_type_" + refreshId, optional: true, element: { type: "static_select", action_id: "type_input", placeholder: { type: "plain_text", text: "Select data type" }, initial_option: { text: { type: "plain_text", text: "Short Text" }, value: "plain_text_input" }, options: [{ text: { type: "plain_text", text: "Short Text" }, value: "plain_text_input" }, { text: { type: "plain_text", text: "Paragraph (Multi-line)" }, value: "plain_text_input_multi" }, { text: { type: "plain_text", text: "Date Picker" }, value: "datepicker" }, { text: { type: "plain_text", text: "Time Picker" }, value: "timepicker" }, { text: { type: "plain_text", text: "User Select" }, value: "multi_users_select" }, { text: { type: "plain_text", text: "Dropdown (Select One)" }, value: "static_select" }, { text: { type: "plain_text", text: "Dropdown (Select Multiple)" }, value: "multi_static_select" }] }, label: { type: "plain_text", text: "Data Type" } },
    { type: "input", block_id: "new_options_" + refreshId, optional: true, element: { type: "plain_text_input", action_id: "options_input", placeholder: { type: "plain_text", text: "e.g., 10%, 20%, Custom" } }, label: { type: "plain_text", text: "Choices (For Dropdowns & Checkboxes)" } },
  ];

  if (!isQuoteProductFlow) {
    blocks.push({ type: "input", block_id: "new_req_" + refreshId, optional: true, element: { type: "checkboxes", action_id: "req_input", options: [{ text: { type: "plain_text", text: "Make this field mandatory" }, value: "true" }] }, label: { type: "plain_text", text: "Requirements" } });
  }

  blocks.push({ type: "actions", block_id: "add_field_actions", elements: [{ type: "button", text: { type: "plain_text", text: "Commit Field to Schema" }, action_id: "add_new_field_btn", style: "primary", value: "add" }] });
  return blocks;
}

async function getManageCustomFieldsBlocks(client: any, schemaId: string) {
  const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: schemaId });
  const fields = res.ok && res.item?.custom_fields ? res.item.custom_fields : [];
  const broadcastBlocks = await getBroadcastSection(client, schemaId);

  const blocks: any[] = [
    getSchemaSelector(schemaId), { type: "divider" },
    getNavHeader("manage"), { type: "divider" },
    ...broadcastBlocks,
    { type: "header", text: { type: "plain_text", text: "Manage Custom Fields" } },
  ];

  if (fields.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No custom fields configured for this object yet._" } });
  } else {
    fields.forEach((f: any, index: number) => {
      let displayType = f.type;
      if (f.dropdown_options && f.dropdown_options.length > 0) displayType += " (" + f.dropdown_options.join(", ") + ")";
      blocks.push(
        { type: "section", block_id: "field_settings_" + index, text: { type: "mrkdwn", text: "*" + f.name + "* [" + displayType + "] - " + (f.required ? "required" : "optional") } },
        { type: "actions", block_id: "move_actions_" + index, elements: [{ type: "button", text: { type: "plain_text", text: ":arrow_up: Up" }, action_id: "move_up", value: String(index) }, { type: "button", text: { type: "plain_text", text: ":arrow_down: Down" }, action_id: "move_down", value: String(index) }, { type: "button", text: { type: "plain_text", text: "Delete" }, style: "danger", action_id: "delete_custom_field_action", value: String(index) }] },
        { type: "divider" }
      );
    });
  }
  return blocks;
}

async function getUnifiedFieldOptions(client: any) {
  const qRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "schema_quote" });
  const pRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "schema_quote_product" });
  const options: any[] = [
    { text: { type: "plain_text", text: ":page_facing_up: Native: Total Quote Dollar Value ($)" }, value: "quote.total_amount" },
    { text: { type: "plain_text", text: ":page_facing_up: Native: Customer Record Name" }, value: "quote.customer_name" },
  ];
  (qRes.item?.custom_fields || []).forEach((f: any, idx: number) => options.push({ text: { type: "plain_text", text: ":page_facing_up: Quote Custom: " + (f.name || "Field") }, value: "quote.custom_field_" + idx }));
  (pRes.item?.custom_fields || []).forEach((f: any, idx: number) => options.push({ text: { type: "plain_text", text: ":package: Product Spec: " + (f.name || "Spec") }, value: "product.item_custom_" + idx }));
  return options;
}

async function getAddApprovalRuleBlocks(client: any, refreshId: number, editRule: any = null, editIdx: number = -1) {
  const fieldOptions = await getUnifiedFieldOptions(client);
  const operatorOptions = [{ text: { type: "plain_text", text: "Equals exactly ( == )" }, value: "EQ" }, { text: { type: "plain_text", text: "Contains partial text" }, value: "CONTAINS" }, { text: { type: "plain_text", text: "Contains exact text (Case-Strict)" }, value: "CONTAINS_EXACT" }, { text: { type: "plain_text", text: "Is greater than ( > )" }, value: "GT" }, { text: { type: "plain_text", text: "Is less than ( < )" }, value: "LT" }];
  const quorumOpts = [{ text: { type: "plain_text", text: "Match ALL conditions below (AND)" }, value: "AND" }, { text: { type: "plain_text", text: "Match ANY condition below (OR)" }, value: "OR" }];
  const initQuorum = editRule ? quorumOpts.find((o) => o.value === editRule.match_type) : quorumOpts[0];
  const headerTitle = editRule ? `Edit Approval Step #${editIdx + 1}` : "Approval Details";
  const initUsersArr = editRule?.approver_ids ?? (editRule?.approver_id ? [editRule.approver_id] : undefined);

  const approversSelectElement: any = { type: "multi_users_select", action_id: "users_val", placeholder: { type: "plain_text", text: "Select approvers in sequential order..." } };
  if (initUsersArr && initUsersArr.length > 0) approversSelectElement.initial_users = initUsersArr;

  const blocks: any[] = [
    getSchemaSelector("advanced_approval_rules"), { type: "divider" },
    getNavHeader("add"), { type: "divider" },
    { type: "header", text: { type: "plain_text", text: headerTitle } },
    { type: "input", block_id: `step_name_${refreshId}`, optional: false, element: { type: "plain_text_input", action_id: "name_val", placeholder: { type: "plain_text", text: "e.g., Tier 2: Executive Escalation" }, initial_value: editRule?.step_name || undefined }, label: { type: "plain_text", text: "Name" } },
    { type: "input", block_id: `step_approvers_${refreshId}`, optional: false, element: approversSelectElement, label: { type: "plain_text", text: "Sequential Approvers (Order clicked = Order of execution)" } },
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "Assignment Criteria" } },
    { type: "input", block_id: `step_quorum_${refreshId}`, optional: false, element: { type: "static_select", action_id: "quorum_val", placeholder: { type: "plain_text", text: "Select gate..." }, initial_option: initQuorum, options: quorumOpts }, label: { type: "plain_text", text: "Condition Gate" } },
  ];

  for (let i = 0; i < 3; i++) {
    const isOpt = i > 0;
    const existingCond = editRule?.conditions?.[i];
    const fSelect: any = { type: "static_select", action_id: "f_val", placeholder: { type: "plain_text", text: "Select subject field..." }, options: fieldOptions };
    if (existingCond) fSelect.initial_option = fieldOptions.find((o) => o.value === existingCond.field_ref);
    const oSelect: any = { type: "static_select", action_id: "o_val", placeholder: { type: "plain_text", text: "Select evaluation..." }, options: operatorOptions };
    if (existingCond) oSelect.initial_option = operatorOptions.find((o) => o.value === existingCond.operator);

    blocks.push(
      { type: "section", text: { type: "mrkdwn", text: "*" + (i === 0 ? "Condition 1 (Mandatory)" : `Condition ${i + 1} (Optional)`) + "*" } },
      { type: "input", block_id: `c_field_${i}_${refreshId}`, optional: isOpt, element: fSelect, label: { type: "plain_text", text: "Inspect Field" } },
      { type: "input", block_id: `c_op_${i}_${refreshId}`, optional: isOpt, element: oSelect, label: { type: "plain_text", text: "Logical Operator" } },
      { type: "input", block_id: `c_target_${i}_${refreshId}`, optional: isOpt, element: { type: "plain_text_input", action_id: "t_val", placeholder: { type: "plain_text", text: "e.g., 10000, US-West" }, initial_value: existingCond ? existingCond.target_val : undefined }, label: { type: "plain_text", text: "Value" } },
      { type: "divider" }
    );
  }

  const actionElements: any[] = [{ type: "button", text: { type: "plain_text", text: editRule ? "Update Rule" : "Add Rule" }, action_id: "save_approval_rule_btn", style: "primary", value: editRule ? String(editIdx) : "new" }];
  if (editRule) actionElements.push({ type: "button", text: { type: "plain_text", text: "Cancel Edit" }, action_id: "go_to_manage", value: "manage" });
  blocks.push({ type: "actions", block_id: "save_rule_actions", elements: actionElements });
  return blocks;
}

async function getManageApprovalRulesBlocks(client: any) {
  const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "advanced_approval_rules" });
  const rulesArray = res.item?.approval_rules ? JSON.parse(res.item.approval_rules) : [];

  const blocks: any[] = [
    getSchemaSelector("advanced_approval_rules"), { type: "divider" },
    getNavHeader("manage"), { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "Active Approval Rules" } },
  ];
  if (rulesArray.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No advanced approval rules configured._" } });
    return blocks;
  }

  rulesArray.forEach((r: any, idx: number) => {
    const chainFormatted = (r.approver_ids ?? (r.approver_id ? [r.approver_id] : [])).map((id: string) => `<@${id}>`).join(" -> ") || "_Unassigned_";
    blocks.push(
      { type: "section", text: { type: "mrkdwn", text: "*" + (idx + 1) + ". " + r.step_name + "*\n_Escalation Chain:_ " + chainFormatted + "\n_Quorum:_ Match " + r.match_type + " across " + r.conditions.length + " condition(s)" } },
      { type: "actions", block_id: "rule_actions_" + idx, elements: [{ type: "button", text: { type: "plain_text", text: "Edit" }, action_id: "edit_approval_rule_action", value: String(idx) }, { type: "button", text: { type: "plain_text", text: "Delete" }, style: "danger", action_id: "delete_approval_rule_action", value: String(idx) }] },
      { type: "divider" }
    );
  });
  return blocks;
}

async function getAddBlocks(client: any, refreshId: number, schemaId: string, editRule: any = null, editIdx: number = -1) {
  if (schemaId === "advanced_approval_rules") return await getAddApprovalRuleBlocks(client, refreshId, editRule, editIdx);
  return await getAddCustomFieldBlocks(client, refreshId, schemaId);
}

async function getManageBlocks(client: any, schemaId: string) {
  if (schemaId === "advanced_approval_rules") return await getManageApprovalRulesBlocks(client);
  return await getManageCustomFieldsBlocks(client, schemaId);
}

export default SlackFunction(
  ManageSettingsFunctionDefinition,
  async ({ inputs, client }) => {
    const refreshId = Math.floor(Math.random() * 1_000_000);
    const viewRes = await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: { type: "modal", callback_id: "settings_add_view", private_metadata: "v4_final_config", title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, blocks: await getAddBlocks(client, refreshId, "v4_final_config") },
    });
    if (!viewRes.ok) return { error: "Open error: " + viewRes.error };
    return { completed: false };
  }
)
  .addBlockActionsHandler(["select_schema_action"], async ({ action, body, client }) => {
    if (!body.view?.id) return { completed: false };
    await autoSaveTabState(body, client);
    const newId = action.selected_option.value;
    await client.views.update({
      view_id: body.view.id,
      view: { type: "modal", callback_id: body.view.callback_id === "settings_add_view" ? "settings_add_view" : "settings_manage_view", private_metadata: newId, title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, blocks: body.view.callback_id === "settings_add_view" ? await getAddBlocks(client, Math.floor(Math.random() * 1_000_000), newId) : await getManageBlocks(client, newId) },
    });
    return { completed: false };
  })
  .addBlockActionsHandler(["go_to_add", "go_to_manage"], async ({ action, body, client }) => {
    if (!body.view?.id) return { completed: false };
    await autoSaveTabState(body, client);
    const curId = body.view.private_metadata || "v4_final_config";
    const isAdd = action.action_id === "go_to_add";
    await client.views.update({
      view_id: body.view.id,
      view: { type: "modal", callback_id: isAdd ? "settings_add_view" : "settings_manage_view", private_metadata: curId, title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, blocks: isAdd ? await getAddBlocks(client, Math.floor(Math.random() * 1_000_000), curId) : await getManageBlocks(client, curId) },
    });
    return { completed: false };
  })
  .addBlockActionsHandler(["add_new_field_btn"], async ({ body, client }) => {
    if (!body.view?.id) return { completed: false };
    const curId = body.view.private_metadata || "v4_final_config";
    const values = body.view.state.values;

    let newName = "", newType = "plain_text_input", newOpts = "", isReq = false;
    for (const bId of Object.keys(values)) {
      if (bId.startsWith("new_name_")) newName = values[bId].name_input?.value ?? "";
      if (bId.startsWith("new_type_")) newType = values[bId].type_input?.selected_option?.value ?? "plain_text_input";
      if (bId.startsWith("new_options_")) newOpts = values[bId].options_input?.value ?? "";
      if (bId.startsWith("new_req_")) isReq = (values[bId].req_input?.selected_options?.length ?? 0) > 0;
    }
    if (curId === "schema_quote_product") isReq = false; 

    if (newName.trim() !== "") {
      const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: curId });
      const fields = res.item?.custom_fields || [];
      fields.push({ name: newName.trim(), type: newType, required: isReq, show_on_form: true, show_on_table: true, dropdown_options: newOpts.trim() !== "" ? newOpts.split(",").map((s) => s.trim()).filter((s) => s !== "") : [] });
      
      const finalChannels = getSafeChannelsFromState(values, curId, res.item?.broadcast_channels);
      await client.apps.datastore.put({ datastore: TenantSettingsDatastore.name, item: { id: curId, custom_fields: fields, broadcast_channels: finalChannels, approval_rules: res.item?.approval_rules } });
    }

    await client.views.update({
      view_id: body.view.id,
      view: { type: "modal", callback_id: "settings_add_view", private_metadata: curId, title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, blocks: await getAddBlocks(client, Math.floor(Math.random() * 1_000_000), curId) },
    });
    return { completed: false };
  })
  .addBlockActionsHandler(["move_up", "move_down"], async ({ action, body, client }) => {
    if (!body.view?.id) return { completed: false };
    const curId = body.view.private_metadata || "v4_final_config";
    const isUp = action.action_id === "move_up";
    const idx = parseInt(action.value, 10);
    const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: curId });
    const fields = res.item?.custom_fields || [];

    if (isUp && idx > 0) [fields[idx - 1], fields[idx]] = [fields[idx], fields[idx - 1]];
    else if (!isUp && idx < fields.length - 1) [fields[idx], fields[idx + 1]] = [fields[idx + 1], fields[idx]];

    const finalChannels = getSafeChannelsFromState(body.view.state.values, curId, res.item?.broadcast_channels);
    await client.apps.datastore.put({ datastore: TenantSettingsDatastore.name, item: { id: curId, custom_fields: fields, broadcast_channels: finalChannels, approval_rules: res.item?.approval_rules } });
    
    await client.views.update({
      view_id: body.view.id,
      view: { type: "modal", callback_id: "settings_manage_view", private_metadata: curId, title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, notify_on_close: false, blocks: await getManageBlocks(client, curId) },
    });
    return { completed: false };
  })
  .addBlockActionsHandler(["delete_custom_field_action"], async ({ action, body, client }) => {
    if (!body.view?.id) return { completed: false };
    const curId = body.view.private_metadata || "v4_final_config";
    const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: curId });
    
    if (res.ok && res.item?.custom_fields) {
      const fields = res.item.custom_fields;
      fields.splice(parseInt(action.value, 10), 1);
      
      const finalChannels = getSafeChannelsFromState(body.view.state.values, curId, res.item.broadcast_channels);
      await client.apps.datastore.put({ datastore: TenantSettingsDatastore.name, item: { id: curId, custom_fields: fields, broadcast_channels: finalChannels, approval_rules: res.item.approval_rules } });
      
      await client.views.update({
        view_id: body.view.id,
        view: { type: "modal", callback_id: "settings_manage_view", private_metadata: curId, title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, blocks: await getManageBlocks(client, curId) },
      });
    }
    return { completed: false };
  })
  .addBlockActionsHandler(["edit_approval_rule_action"], async ({ action, body, client }) => {
    if (!body.view?.id) return { completed: false };
    const editIdx = parseInt(action.value, 10);
    const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "advanced_approval_rules" });
    if (res.ok && res.item?.approval_rules) {
      const rules = JSON.parse(res.item.approval_rules);
      if (rules[editIdx]) {
        await client.views.update({
          view_id: body.view.id,
          view: { type: "modal", callback_id: "settings_add_view", private_metadata: "advanced_approval_rules", title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, blocks: await getAddBlocks(client, Math.floor(Math.random() * 1_000_000), "advanced_approval_rules", rules[editIdx], editIdx) },
        });
      }
    }
    return { completed: false };
  })
  .addBlockActionsHandler(["save_approval_rule_btn"], async ({ action, body, client }) => {
    if (!body.view?.id) return { completed: false };
    const vals = body.view.state.values;
    const editIdx = parseInt(action.value, 10);
    let sName = "", curApprovers: string[] = [], quorum = "AND";
    const compiledConditions: any[] = [];

    for (const [bId, aObj] of Object.entries(vals)) {
      if (bId.startsWith("step_name_")) sName = (aObj as any).name_val?.value || "";
      if (bId.startsWith("step_approvers_")) curApprovers = (aObj as any).users_val?.selected_users || [];
      if (bId.startsWith("step_quorum_")) quorum = (aObj as any).quorum_val?.selected_option?.value || "AND";
    }

    for (let i = 0; i < 3; i++) {
      let fRef = "", op = "", tVal = "";
      for (const [bId, aObj] of Object.entries(vals)) {
        if (bId.startsWith(`c_field_${i}_`)) fRef = (aObj as any).f_val?.selected_option?.value || "";
        if (bId.startsWith(`c_op_${i}_`)) op = (aObj as any).o_val?.selected_option?.value || "";
        if (bId.startsWith(`c_target_${i}_`)) tVal = (aObj as any).t_val?.value || "";
      }
      if (fRef && op && tVal) compiledConditions.push({ field_ref: fRef, operator: op, target_val: tVal });
    }

    if (sName && curApprovers.length > 0 && compiledConditions.length > 0) {
      const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "advanced_approval_rules" });
      const rules = res.item?.approval_rules ? JSON.parse(res.item.approval_rules) : [];
      const compiledRuleObj = { step_id: "rule_" + Date.now(), step_name: sName, approver_ids: curApprovers, match_type: quorum, conditions: compiledConditions };

      if (!isNaN(editIdx) && editIdx >= 0 && editIdx < rules.length) rules[editIdx] = compiledRuleObj;
      else rules.push(compiledRuleObj);

      await client.apps.datastore.put({ datastore: TenantSettingsDatastore.name, item: { id: "advanced_approval_rules", approval_rules: JSON.stringify(rules), custom_fields: [], broadcast_channels: "" } });
    }

    await client.views.update({
      view_id: body.view.id,
      view: { type: "modal", callback_id: "settings_manage_view", private_metadata: "advanced_approval_rules", title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, blocks: await getManageBlocks(client, "advanced_approval_rules") },
    });
    return { completed: false };
  })
  .addBlockActionsHandler(["delete_approval_rule_action"], async ({ action, body, client }) => {
    if (!body.view?.id) return { completed: false };
    const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "advanced_approval_rules" });
    if (res.ok && res.item?.approval_rules) {
      const rules = JSON.parse(res.item.approval_rules);
      rules.splice(parseInt(action.value, 10), 1);
      await client.apps.datastore.put({ datastore: TenantSettingsDatastore.name, item: { id: "advanced_approval_rules", approval_rules: JSON.stringify(rules), custom_fields: [], broadcast_channels: "" } });
      
      await client.views.update({
        view_id: body.view.id,
        view: { type: "modal", callback_id: "settings_manage_view", private_metadata: "advanced_approval_rules", title: { type: "plain_text", text: "Setup" }, submit: { type: "plain_text", text: "Save" }, close: { type: "plain_text", text: "Cancel" }, blocks: await getManageApprovalRulesBlocks(client) },
      });
    }
    return { completed: false };
  })
  .addBlockActionsHandler(["broadcast_channels_action", "f_val", "o_val", "quorum_val", "users_val"], async () => ({ completed: false }))
  .addViewSubmissionHandler(["settings_add_view", "settings_manage_view"], async ({ body, client }) => {
    // 🎯 WIDENED GATE: Extract dynamically isolated ID for Account saves too
    const curId = body.view?.private_metadata || "v4_final_config";
    if (curId === "schema_quote" || curId === "v4_final_config" || curId === "schema_account") {
      const stateVals = body.view?.state?.values;
      const blockId = "broadcast_channels_block_" + curId; 
      const selectedChannels = stateVals?.[blockId]?.["broadcast_channels_action"]?.selected_channels;
      
      if (selectedChannels) {
        const res = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: curId });
        await client.apps.datastore.put({
          datastore: TenantSettingsDatastore.name,
          item: {
            id: curId,
            custom_fields: res.item?.custom_fields || [],
            broadcast_channels: JSON.stringify(selectedChannels),
            approval_rules: res.item?.approval_rules,
          },
        });
      }
    }
    return { response_action: "clear" };
  });