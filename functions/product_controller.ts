import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { ProductsDatastore } from "../datastores/products.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const ProductControllerDefinition = DefineFunction({
  callback_id: "product_controller",
  title: "New Product",
  description: "Handles creation, broadcasting, and inline editing of SKUs",
  source_file: "functions/product_controller.ts",
  input_parameters: {
    properties: {
      interactivity: { type: Schema.slack.types.interactivity },
    },
    required: ["interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

function buildDynamicElement(field: any, actionId: string, initVal?: any) {
  const safeStr = initVal !== undefined && initVal !== null ? String(initVal) : undefined;
  switch (field.type) {
    case "plain_text_input_multi":
      return { type: "plain_text_input", action_id: actionId, multiline: true, initial_value: safeStr };
    case "datepicker":
      return { type: "datepicker", action_id: actionId, initial_date: safeStr };
    case "timepicker":
      return { type: "timepicker", action_id: actionId, initial_time: safeStr };
    case "multi_users_select":
      return { type: "multi_users_select", action_id: actionId };
    case "checkboxes": {
      const rawOpts = field.dropdown_options?.length > 0 ? field.dropdown_options : ["No Options Configured"];
      const blockOpts = rawOpts.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));
      const resObj: any = { type: "checkboxes", action_id: actionId, options: blockOpts };
      if (safeStr) {
        const savedArr = safeStr.split(",").map((s) => s.trim());
        const initOpts = blockOpts.filter((bOpt) => savedArr.includes(bOpt.value));
        if (initOpts.length > 0) resObj.initial_options = initOpts;
      }
      return resObj;
    }
    case "static_select":
    case "multi_static_select": {
      const rawOpts = field.dropdown_options?.length > 0 ? field.dropdown_options : ["No Options Configured"];
      const blockOpts = rawOpts.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));
      if (field.type === "static_select") {
        return {
          type: "static_select", action_id: actionId,
          placeholder: { type: "plain_text", text: "Select..." },
          options: blockOpts,
          initial_option: safeStr ? blockOpts.find((o) => o.value === safeStr) : undefined,
        };
      } else {
        const mObj: any = {
          type: "multi_static_select", action_id: actionId,
          placeholder: { type: "plain_text", text: "Select..." },
          options: blockOpts,
        };
        if (safeStr) {
          const savedArr = safeStr.split(",").map((s) => s.trim());
          const initOpts = blockOpts.filter((bOpt) => savedArr.includes(bOpt.value));
          if (initOpts.length > 0) mObj.initial_options = initOpts;
        }
        return mObj;
      }
    }
    case "plain_text_input":
    default:
      return { type: "plain_text_input", action_id: actionId, initial_value: safeStr };
  }
}

// 🎯 UPGRADED UI: 2-Column Grid matching the Quote Design Language
function buildDigitalFlyer(skuId: string, prodName: string, prodDesc: string, parsedPrice: number, isActive: boolean, metadataBlob: any, customFieldDefs: any[], authorId: string) {
  const statusDisplay = isActive ? "Active" : "Inactive";

  const blocks: any[] = [
    { 
      type: "header", 
      text: { type: "plain_text", text: `New Product Logged ${prodName}` } // 🎯 ID completely removed from Header
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Product ID:*\n${skuId}` }, // 🎯 Replaced Total Value with Product ID
        { type: "mrkdwn", text: `*List Price:*\n$${parsedPrice.toLocaleString()}` }, // 🎯 Preserved Price
        { type: "mrkdwn", text: `*Status:*\n${statusDisplay}` },
        { type: "mrkdwn", text: `*Prepared By:*\n<@${authorId}>` }
      ]
    },
    { type: "divider" }
  ];

  // Map Custom Specifications
  const cKeys = Object.keys(metadataBlob).filter((k) => k.startsWith("custom_field_"));
  if (cKeys.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Detailed Information*" } // Matched Subheader
    });

    let specString = "";
    cKeys.forEach((k) => {
      const fIdx = parseInt(k.replace("custom_field_", ""), 10);
      const humanName = customFieldDefs[fIdx]?.name || "Spec";
      specString += `*${humanName}:* ${metadataBlob[k]}\n\n`;
    });

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: specString.trim() }
    });
  }

  // Append Description/Overview
  if (prodDesc && prodDesc.trim() !== "") {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Description*\n> ${prodDesc}` }
      }
    );
  }

  // Action Buttons matched to Quote Style
  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      elements: [
        { 
          type: "button", 
          text: { type: "plain_text", text: "Edit" }, 
          action_id: "edit_product_action", 
          value: skuId,
          style: "primary" // The Green Button
        }
      ]
    }
  );

  return blocks;
}

export default SlackFunction(
  ProductControllerDefinition,
  async ({ inputs, client }) => {
    const getRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "v4_final_config" });
    const tenantConfig: any[] = getRes.item?.custom_fields || [];

    const dynamicBlocks: any[] = [
      { type: "input", block_id: "sku_block", element: { type: "plain_text_input", action_id: "id", placeholder: { type: "plain_text", text: "e.g., SRV-GEN2-128" } }, label: { type: "plain_text", text: "Product ID" } },
      { type: "input", block_id: "product_name_block", element: { type: "plain_text_input", action_id: "name_input", placeholder: { type: "plain_text", text: "e.g., Cluster Server" } }, label: { type: "plain_text", text: "Product Name *" } },
      { type: "input", block_id: "desc_block", element: { type: "plain_text_input", action_id: "desc", multiline: true }, label: { type: "plain_text", text: "Description *" } },
      { type: "input", block_id: "price_block", element: { type: "plain_text_input", action_id: "price", placeholder: { type: "plain_text", text: "1999.00" } }, label: { type: "plain_text", text: "List Price" } },
      {
        type: "input", block_id: "active_block", optional: false,
        element: { type: "static_select", action_id: "is_active", initial_option: { text: { type: "plain_text", text: "Active" }, value: "true" }, options: [{ text: { type: "plain_text", text: "Active" }, value: "true" }, { text: { type: "plain_text", text: "Inactive" }, value: "false" }] },
        label: { type: "plain_text", text: "Available for Quoting" },
      }
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
      view: { type: "modal", callback_id: "product_creation_modal", title: { type: "plain_text", text: "Create Product" }, submit: { type: "plain_text", text: "Save & Publish" }, blocks: dynamicBlocks },
    });
    return { completed: false };
  }
)
.addViewSubmissionHandler(["product_creation_modal"], async ({ view, body, client }) => {
  const values = view.state.values;
  const skuId = values.sku_block?.id?.value || "SKU-UNKNOWN";
  const prodName = values.product_name_block?.name_input?.value || "Product";
  const prodDesc = values.desc_block?.desc?.value || "No description provided.";
  const rawPriceStr = values.price_block?.price?.value || "0";
  const parsedPrice = parseFloat(rawPriceStr);
  const isActive = values.active_block?.is_active?.selected_option?.value === "true";

  if (isNaN(parsedPrice) || parsedPrice < 0) {
    return { response_action: "errors", errors: { price_block: "Please enter a valid positive numeric list price." } };
  }

  const metadataBlob: Record<string, any> = {};
  for (const [blockId, actionObj] of Object.entries(values)) {
    if (blockId.startsWith("custom_field_")) {
      const aData = (actionObj as any)[Object.keys(actionObj as object)[0]];
      const val = aData?.value ?? aData?.selected_date ?? aData?.selected_time ?? aData?.selected_option?.value ?? aData?.selected_options?.map((o: any) => o.value).join(", ");
      if (val) metadataBlob[blockId] = val;
    }
  }

  await client.apps.datastore.put({ datastore: ProductsDatastore.name, item: { id: skuId, name: prodName, description: prodDesc, price: parsedPrice, is_active: isActive, metadata: JSON.stringify(metadataBlob) } });

  const sRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "v4_final_config" });
  let targetRooms = sRes.item?.broadcast_channels ? JSON.parse(sRes.item.broadcast_channels) : [];
  if (targetRooms.length === 0) targetRooms = [body.user.id];

  const flyerBlocks = buildDigitalFlyer(skuId, prodName, prodDesc, parsedPrice, isActive, metadataBlob, sRes.item?.custom_fields || [], body.user.id);
  
  // 🎯 Removed ID from the fallback text notification subject
  await Promise.allSettled(targetRooms.map((room) => client.chat.postMessage({ channel: room, blocks: flyerBlocks, text: `New Product Published: ${prodName}` })));

  return { response_action: "clear" }; // Keeps function execution alive to listen for Edits!
})
.addBlockActionsHandler(["edit_product_action"], async ({ action, body, client }) => {
  const skuId = action.value;
  const pRes = await client.apps.datastore.get({ datastore: ProductsDatastore.name, id: skuId });
  if (!pRes.item) return { completed: false };

  const sRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "v4_final_config" });
  const tenantConfig = sRes.item?.custom_fields || [];
  const metaBlob = pRes.item.metadata ? JSON.parse(pRes.item.metadata) : {};

  const dynamicBlocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: `Modifying SKU: *${skuId}*` } },
    { type: "input", block_id: "product_name_block", element: { type: "plain_text_input", action_id: "name_input", initial_value: pRes.item.name }, label: { type: "plain_text", text: "Product Name *" } },
    { type: "input", block_id: "desc_block", element: { type: "plain_text_input", action_id: "desc", multiline: true, initial_value: pRes.item.description }, label: { type: "plain_text", text: "Description *" } },
    { type: "input", block_id: "price_block", element: { type: "plain_text_input", action_id: "price", initial_value: String(pRes.item.price) }, label: { type: "plain_text", text: "List Price" } },
    { type: "input", block_id: "active_block", optional: false, element: { type: "static_select", action_id: "is_active", initial_option: { text: { type: "plain_text", text: pRes.item.is_active ? "Active" : "Inactive" }, value: pRes.item.is_active ? "true" : "false" }, options: [{ text: { type: "plain_text", text: "Active" }, value: "true" }, { text: { type: "plain_text", text: "Inactive" }, value: "false" }] }, label: { type: "plain_text", text: "Available for Quoting" } }
  ];

  tenantConfig.forEach((field, index) => {
    if (field.show_on_form) {
      dynamicBlocks.push({ type: "input", block_id: `custom_field_${index}`, optional: !field.required, element: buildDynamicElement(field, `custom_action_${index}`, metaBlob[`custom_field_${index}`]), label: { type: "plain_text", text: field.name + (field.required ? " *" : "") } });
    }
  });

  await client.views.open({
    interactivity_pointer: body.interactivity.interactivity_pointer,
    view: { type: "modal", callback_id: "submit_edit_product_modal", private_metadata: JSON.stringify({ sku_id: skuId, channel_id: body.container.channel_id, message_ts: body.container.message_ts }), title: { type: "plain_text", text: "Edit Product" }, submit: { type: "plain_text", text: "Save Changes" }, blocks: dynamicBlocks },
  });
  return { completed: false };
})
.addViewSubmissionHandler(["submit_edit_product_modal"], async ({ view, body, client }) => {
  const meta = JSON.parse(view.private_metadata);
  const vals = view.state.values;
  const parsedPrice = parseFloat(vals.price_block?.price?.value || "0");

  if (isNaN(parsedPrice) || parsedPrice < 0) return { response_action: "errors", errors: { price_block: "Invalid price." } };

  const metadataBlob: Record<string, any> = {};
  for (const [blockId, actionObj] of Object.entries(vals)) {
    if (blockId.startsWith("custom_field_")) {
      const aData = (actionObj as any)[Object.keys(actionObj as object)[0]];
      const val = aData?.value ?? aData?.selected_date ?? aData?.selected_time ?? aData?.selected_option?.value ?? aData?.selected_options?.map((o: any) => o.value).join(", ");
      if (val) metadataBlob[blockId] = val;
    }
  }

  const prodName = vals.product_name_block?.name_input?.value || "Product";
  const prodDesc = vals.desc_block?.desc?.value || "Description";
  const isActive = vals.active_block?.is_active?.selected_option?.value === "true";

  await client.apps.datastore.put({ datastore: ProductsDatastore.name, item: { id: meta.sku_id, name: prodName, description: prodDesc, price: parsedPrice, is_active: isActive, metadata: JSON.stringify(metadataBlob) } });

  const sRes = await client.apps.datastore.get({ datastore: TenantSettingsDatastore.name, id: "v4_final_config" });
  await client.chat.update({
    channel: meta.channel_id, ts: meta.message_ts, text: `Product Updated: ${prodName}`, // 🎯 Removed ID from update fallback text
    blocks: buildDigitalFlyer(meta.sku_id, prodName, prodDesc, parsedPrice, isActive, metadataBlob, sRes.item?.custom_fields || [], body.user.id)
  });

  return { response_action: "clear" };
});