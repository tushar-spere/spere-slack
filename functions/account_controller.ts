import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { AccountsDatastore } from "../datastores/accounts.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const AccountControllerDefinition = DefineFunction({
  callback_id: "account_controller",
  title: "Account Controller",
  description: "Handles creation, broadcasting, and inline editing of Accounts",
  source_file: "functions/account_controller.ts",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

function buildDynamicElement(field: any, actionId: string, initVal?: any) {
  const safeStr = initVal !== undefined && initVal !== null ? String(initVal) : undefined;
  switch (field.type) {
    case "plain_text_input_multi": return { type: "plain_text_input", action_id: actionId, multiline: true, initial_value: safeStr };
    case "datepicker": return { type: "datepicker", action_id: actionId, initial_date: safeStr };
    case "timepicker": return { type: "timepicker", action_id: actionId, initial_time: safeStr };
    case "multi_users_select": return { type: "multi_users_select", action_id: actionId };
    case "checkboxes": {
      const rawOpts = field.dropdown_options?.length > 0 ? field.dropdown_options : ["No Options"];
      const blockOpts = rawOpts.map((opt: string) => ({ text: { type: "plain_text", text: String(opt).substring(0, 75) }, value: String(opt).substring(0, 75) }));
      const resObj: any = { type: "checkboxes", action_id: actionId, options: blockOpts };
      if (safeStr) {
        const initOpts = blockOpts.filter((bOpt) => safeStr.split(",").map((s) => s.trim()).includes(bOpt.value));
        if (initOpts.length > 0) resObj.initial_options = initOpts;
      }
      return resObj;
    }
    case "static_select":
    case "multi_static_select": {
      const rawOpts = field.dropdown_options?.length > 0 ? field.dropdown_options : ["No Options"];
      const blockOpts = rawOpts.map((opt: string) => ({ text: { type: "plain_text", text: String(opt).substring(0, 75) }, value: String(opt).substring(0, 75) }));
      if (field.type === "static_select") {
        return { type: "static_select", action_id: actionId, placeholder: { type: "plain_text", text: "Select..." }, options: blockOpts, initial_option: safeStr ? blockOpts.find((o) => o.value === safeStr) : undefined };
      } else {
        const mObj: any = { type: "multi_static_select", action_id: actionId, placeholder: { type: "plain_text", text: "Select..." }, options: blockOpts };
        if (safeStr) {
          const initOpts = blockOpts.filter((bOpt) => safeStr.split(",").map((s) => s.trim()).includes(bOpt.value));
          if (initOpts.length > 0) mObj.initial_options = initOpts;
        }
        return mObj;
      }
    }
    case "plain_text_input":
    default: return { type: "plain_text_input", action_id: actionId, initial_value: safeStr };
  }
}

// 🎯 THE DOSSIER: Premium 360-Degree Account View
function buildAccountDossier(accountId: string, accountName: string, metadataBlob: any, customFieldDefs: any[], authorId: string) {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `Account: ${accountName}` } },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Account ID:*\n${accountId}` },
        { type: "mrkdwn", text: `*Account Owner:*\n<@${authorId}>` },
        { type: "mrkdwn", text: `*Created On:*\n${new Date().toISOString().split('T')[0]}` }
      ]
    }
  ];

  const cKeys = Object.keys(metadataBlob).filter((k) => k.startsWith("custom_field_"));
  if (cKeys.length > 0) {
    blocks.push(
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: "*Firmographics & Details:*" } }
    );

    let specString = "";
    cKeys.forEach((k) => {
      const fIdx = parseInt(k.replace("custom_field_", ""), 10);
      const humanName = customFieldDefs[fIdx]?.name || "Field";
      specString += `*${humanName}:* ${metadataBlob[k]}\n\n`;
    });

    blocks.push({ type: "section", text: { type: "mrkdwn", text: specString.trim() } });
  }

  blocks.push(
    { type: "divider" },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Edit Account" }, action_id: "edit_account_action", value: accountId, style: "primary" }] }
  );

  return blocks;
}

export default SlackFunction(
  AccountControllerDefinition,
  async ({ inputs, client }) => {
    const getRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "schema_account" });
    const tenantConfig: any[] = getRes.item?.custom_fields || [];

    const dynamicBlocks: any[] = [
      { type: "input", block_id: "account_name_block", element: { type: "plain_text_input", action_id: "name_input", placeholder: { type: "plain_text", text: "e.g., Acme Corporation" } }, label: { type: "plain_text", text: "Account Name *" } }
    ];

    tenantConfig.forEach((field, index) => {
      if (field.show_on_form) {
        dynamicBlocks.push({
          type: "input", block_id: `custom_field_${index}`, optional: !field.required,
          element: buildDynamicElement(field, `custom_action_${index}`),
          label: { type: "plain_text", text: field.name + (field.required ? " *" : "") },
        });
      }
    });

    await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: { type: "modal", callback_id: "account_creation_modal", title: { type: "plain_text", text: "Create Account" }, submit: { type: "plain_text", text: "Save Account" }, blocks: dynamicBlocks },
    });
    return { completed: false };
  }
)
.addViewSubmissionHandler(["account_creation_modal"], async ({ view, body, client }) => {
  const values = view.state.values;
  const accName = values.account_name_block?.name_input?.value || "Unknown Account";
  
  // Clean auto-generated ID (e.g., ACC-847291)
  const accId = "ACC-" + Date.now().toString().slice(-6);

  const metadataBlob: Record<string, any> = {};
  for (const [blockId, actionObj] of Object.entries(values)) {
    if (blockId.startsWith("custom_field_")) {
      const aData = (actionObj as any)[Object.keys(actionObj as object)[0]];
      const val = aData?.value ?? aData?.selected_date ?? aData?.selected_time ?? aData?.selected_option?.value ?? aData?.selected_options?.map((o: any) => o.value).join(", ");
      if (val) metadataBlob[blockId] = val;
    }
  }

  await client.apps.datastore.put({ datastore: AccountsDatastore.name, item: { id: accId, name: accName, metadata: JSON.stringify(metadataBlob) } });

  const sRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "schema_account" });
  let targetRooms = sRes.item?.broadcast_channels ? JSON.parse(sRes.item.broadcast_channels) : [];
  if (targetRooms.length === 0) targetRooms = [body.user.id];

  const flyerBlocks = buildAccountDossier(accId, accName, metadataBlob, sRes.item?.custom_fields || [], body.user.id);
  await Promise.allSettled(targetRooms.map((room) => client.chat.postMessage({ channel: room, blocks: flyerBlocks, text: `New Account Created: ${accName}` })));

  return { response_action: "clear" }; // Keep worker alive for persistent edits
})
.addBlockActionsHandler(["edit_account_action"], async ({ action, body, client }) => {
  const accId = action.value;
  const aRes = await client.apps.datastore.get({ datastore: AccountsDatastore.name, id: accId });
  if (!aRes.item) return { completed: false };

  const sRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "schema_account" });
  const tenantConfig = sRes.item?.custom_fields || [];
  const metaBlob = aRes.item.metadata ? JSON.parse(aRes.item.metadata) : {};

  const dynamicBlocks: any[] = [
    { type: "input", block_id: "account_name_block", element: { type: "plain_text_input", action_id: "name_input", initial_value: aRes.item.name }, label: { type: "plain_text", text: "Account Name *" } }
  ];

  tenantConfig.forEach((field, index) => {
    if (field.show_on_form) {
      dynamicBlocks.push({ type: "input", block_id: `custom_field_${index}`, optional: !field.required, element: buildDynamicElement(field, `custom_action_${index}`, metaBlob[`custom_field_${index}`]), label: { type: "plain_text", text: field.name + (field.required ? " *" : "") } });
    }
  });

  await client.views.open({
    interactivity_pointer: body.interactivity.interactivity_pointer,
    view: { type: "modal", callback_id: "submit_edit_account_modal", private_metadata: JSON.stringify({ acc_id: accId, channel_id: body.container.channel_id, message_ts: body.container.message_ts }), title: { type: "plain_text", text: "Edit Account" }, submit: { type: "plain_text", text: "Save Changes" }, blocks: dynamicBlocks },
  });
  return { completed: false };
})
.addViewSubmissionHandler(["submit_edit_account_modal"], async ({ view, body, client }) => {
  const meta = JSON.parse(view.private_metadata);
  const vals = view.state.values;
  const accName = vals.account_name_block?.name_input?.value || "Unknown Account";

  const metadataBlob: Record<string, any> = {};
  for (const [blockId, actionObj] of Object.entries(vals)) {
    if (blockId.startsWith("custom_field_")) {
      const aData = (actionObj as any)[Object.keys(actionObj as object)[0]];
      const val = aData?.value ?? aData?.selected_date ?? aData?.selected_time ?? aData?.selected_option?.value ?? aData?.selected_options?.map((o: any) => o.value).join(", ");
      if (val) metadataBlob[blockId] = val;
    }
  }

  await client.apps.datastore.put({ datastore: AccountsDatastore.name, item: { id: meta.acc_id, name: accName, metadata: JSON.stringify(metadataBlob) } });

  const sRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "schema_account" });
  await client.chat.update({
    channel: meta.channel_id, ts: meta.message_ts, text: `Account Updated: ${accName}`,
    blocks: buildAccountDossier(meta.acc_id, accName, metadataBlob, sRes.item?.custom_fields || [], body.user.id)
  });

  return { response_action: "clear" };
});