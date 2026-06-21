import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { QuotesDatastore } from "../datastores/quotes.ts";
import { ProductsDatastore } from "../datastores/products.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const PostQuoteCardFunction = DefineFunction({
  callback_id: "post_quote_card",
  title: "Post Quote Card to Broadcast Channels",
  description:
    "Fetches metadata, broadcasts cards, and powers an in-card Tabular Matrix UI with manual pricing",
  source_file: "functions/post_quote_card.ts",
  input_parameters: {
    properties: {
      quote_id: { type: Schema.types.string },
      customer_name: { type: Schema.types.string },
      total_amount: { type: Schema.types.number },
      sales_rep_id: { type: Schema.slack.types.user_id },
    },
    required: ["quote_id", "customer_name", "total_amount", "sales_rep_id"],
  },
  output_parameters: {
    properties: { message_ts: { type: Schema.types.string } },
    required: ["message_ts"],
  },
});

// Helper: True ASCII Data Table using stored unitPrice
function formatInCardTable(items: any[], customFieldsSchema: any[]) {
  if (!items || items.length === 0) {
    return "```\nNo itemized inventory attached to this quote ledger.\n```";
  }

  const dynamicHeaders = (customFieldsSchema || [])
    .filter((f: any) => f.show_on_table !== false)
    .map((f: any) => String(f.name || "Spec").toUpperCase());

  const wProd = 16;
  const wQty = 5;
  const wCustom = 12;
  const wSub = 11;
  const totalWidth = wProd + wQty + (dynamicHeaders.length * wCustom) + wSub;
  const divider = "—".repeat(totalWidth) + "\n";

  let tableStr = "```\n";
  let headerRow = "PRODUCT".padEnd(wProd) + "QTY".padStart(wQty);
  dynamicHeaders.forEach((h: string) => {
    headerRow += ("  " + h.substring(0, wCustom - 2)).padEnd(wCustom);
  });
  headerRow += "SUBTOTAL".padStart(wSub) + "\n";
  tableStr += headerRow + divider;

  let sumQty = 0;
  let sumTotal = 0;

  items.forEach((item: any) => {
    const qNum = parseInt(item.qty) || 1;
    // MIGRATION FALLBACK APPLIED HERE:
    const uPrice = parseFloat(item.unitPrice ?? 100) || 0;
    const itemSub = qNum * uPrice;
    sumQty += qNum;
    sumTotal += itemSub;

    let rowStr =
      String(item.productName || "Item").substring(0, wProd - 2).padEnd(wProd) +
      String(qNum).padStart(wQty);

    dynamicHeaders.forEach((h: string) => {
      const matchedKey = Object.keys(item.customSpecs || {}).find((k) =>
        k.toUpperCase() === h
      );
      const rawVal = matchedKey ? item.customSpecs[matchedKey] : "-";
      const cleanVal = rawVal !== undefined && rawVal !== null && rawVal !== ""
        ? String(rawVal)
        : "-";
      rowStr += ("  " + cleanVal.substring(0, wCustom - 2)).padEnd(wCustom);
    });

    rowStr += ("$" + itemSub.toLocaleString()).padStart(wSub) + "\n";
    tableStr += rowStr;
  });

  tableStr += divider;
  let totalsRow = "TOTALS".padEnd(wProd) + String(sumQty).padStart(wQty);
  dynamicHeaders.forEach(() => {
    totalsRow += "".padEnd(wCustom);
  });
  totalsRow += ("$" + sumTotal.toLocaleString()).padStart(wSub) + "\n```";

  return tableStr + totalsRow;
}

// Helper: Living Card DOM Builder
async function buildLivingQuoteCard(
  client: any,
  quoteId: string,
  fallbackName: string,
  fallbackTotal: number,
  repId: string,
  isExpanded: boolean,
) {
  const quoteRes = await client.apps.datastore.get({
    datastore: QuotesDatastore.name,
    id: quoteId,
  });
  const quote = quoteRes.item;
  const safeCustomer = quote?.name || fallbackName;
  const metadataBlob = quote?.metadata ? JSON.parse(quote.metadata) : {};
  const lineItemsArray = quote?.line_items ? JSON.parse(quote.line_items) : [];

  let liveCalculatedTotal = 0;
  lineItemsArray.forEach((i: any) => {
    const q = parseInt(i.qty) || 1;
    const p = parseFloat(i.unitPrice ?? 100) || 0;
    liveCalculatedTotal += q * p;
  });
  const displayTotal = liveCalculatedTotal > 0
    ? liveCalculatedTotal
    : fallbackTotal;

  const quoteSchemaRes = await client.apps.datastore.get({
    datastore: TenantSettingsDatastore.name,
    id: "schema_quote",
  });
  const quoteFieldsConfig: any[] = quoteSchemaRes.item?.custom_fields || [];
  const lineItemSchemaRes = await client.apps.datastore.get({
    datastore: TenantSettingsDatastore.name,
    id: "schema_quote_product",
  });
  const lineItemFieldsConfig: any[] = lineItemSchemaRes.item?.custom_fields ||
    [];

  const coreGrid = [
    {
      type: "mrkdwn",
      text: "*Total Value:*\n$" + displayTotal.toLocaleString(),
    },
    { type: "mrkdwn", text: "*Status:*\n🟡 Pending Final Approval" },
    { type: "mrkdwn", text: "*Prepared By:*\n<@" + repId + ">" },
    {
      type: "mrkdwn",
      text: "*Logged:*\n<!date^" + Math.floor(Date.now() / 1000) +
        "^{date_num}|Today>",
    },
  ];

  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📄 Quote #${quoteId} — ${safeCustomer}`,
        emoji: true,
      },
    },
    { type: "divider" },
    { type: "section", fields: coreGrid },
  ];
  const customKeys = Object.keys(metadataBlob).filter((k) =>
    k.startsWith("custom_field_")
  );
  if (customKeys.length > 0) {
    blocks.push({ type: "divider" }, {
      type: "section",
      text: { type: "mrkdwn", text: "*🏷️ Macro Specifications:*" },
    });
    for (const k of customKeys) {
      const idx = parseInt(k.replace("custom_field_", ""), 10);
      const label = quoteFieldsConfig[idx]?.name || "Spec " + (idx + 1);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*" + label + ":* " +
            String(metadataBlob[k]).replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        },
      });
    }
  }

  if (isExpanded && lineItemsArray.length > 0) {
    blocks.push({ type: "divider" }, {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `📦 *Itemized Inventory Breakdown (${lineItemsArray.length} items)*\n` +
          formatInCardTable(lineItemsArray, lineItemFieldsConfig),
      },
    });
  }

  const actionElements: any[] = [{
    type: "button",
    text: { type: "plain_text", text: "✏️ Modify Complete Quote", emoji: true },
    style: "primary",
    action_id: "edit_quote_action",
    value: quoteId,
  }];
  if (lineItemsArray.length > 0) {
    if (!isExpanded) {
      actionElements.push({
        type: "button",
        text: {
          type: "plain_text",
          text: `🔽 View Tabular Details (${lineItemsArray.length})`,
        },
        action_id: "expand_ledger_action",
        value: quoteId,
      });
    } else {actionElements.push({
        type: "button",
        text: { type: "plain_text", text: "🔼 Collapse Tabular Details" },
        action_id: "collapse_ledger_action",
        value: quoteId,
      });}
  }

  blocks.push({ type: "divider" }, {
    type: "actions",
    elements: actionElements,
  });
  return blocks;
}

function buildPreFilledElement(field: any, actionId: string, savedVal: any) {
  const safeVal = savedVal !== undefined && savedVal !== null
    ? String(savedVal)
    : "";
  switch (field.type) {
    case "plain_text_input_multi":
      return {
        type: "plain_text_input",
        action_id: actionId,
        multiline: true,
        initial_value: safeVal,
      };
    case "datepicker":
      return {
        type: "datepicker",
        action_id: actionId,
        initial_date: /^\d{4}-\d{2}-\d{2}$/.test(safeVal) ? safeVal : undefined,
      };
    case "static_select": {
      const opts = (field.dropdown_options || ["Error"]).map((o: string) => ({
        text: { type: "plain_text", text: String(o).substring(0, 75) },
        value: String(o).substring(0, 75),
      }));
      return {
        type: "static_select",
        action_id: actionId,
        placeholder: { type: "plain_text", text: "Select..." },
        options: opts,
        initial_option: opts.find((o: any) => o.value === safeVal),
      };
    }
    default:
      return {
        type: "plain_text_input",
        action_id: actionId,
        initial_value: safeVal,
      };
  }
}

async function buildEditStepTwoView(
  client: any,
  quoteId: string,
  contextMeta: any,
) {
  const refreshId = Math.floor(Math.random() * 1_000_000);
  const quoteRes = await client.apps.datastore.get({
    datastore: QuotesDatastore.name,
    id: quoteId,
  });
  const itemsArray = quoteRes.item?.line_items
    ? JSON.parse(quoteRes.item.line_items)
    : [];

  const prodRes = await client.apps.datastore.query({
    datastore: ProductsDatastore.name,
  });
  const prodOpts = (prodRes.items || []).slice(0, 100).map((p: any) => ({
    text: { type: "plain_text", text: String(p.name).substring(0, 75) },
    value: String(p.id),
  }));
  if (prodOpts.length === 0) {
    prodOpts.push({
      text: { type: "plain_text", text: "Empty!" },
      value: "none",
    });
  }

  const schemaRes = await client.apps.datastore.get({
    datastore: TenantSettingsDatastore.name,
    id: "schema_quote_product",
  });
  const customFieldsConfig = schemaRes.item?.custom_fields || [];

  const blocks: any[] = [{
    type: "header",
    text: { type: "plain_text", text: "Modify Inventory #" + quoteId },
  }, { type: "divider" }];
  itemsArray.forEach((item: any, idx: number) => {
    let specs = Object.entries(item.customSpecs || {}).map(([k, v]) =>
      "*" + k + ":* " + v
    ).join(" | ");
    const uPrice = parseFloat(item.unitPrice ?? 100) || 0;
    const subCalc = (parseInt(item.qty) || 1) * uPrice;

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "📦 *" + item.productName + "* | _Qty:_ " + item.qty + " (@ $" +
          uPrice.toLocaleString() + ") — *$" + subCalc.toLocaleString() +
          "*\n   ↳ " + specs,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "❌ Remove" },
        style: "danger",
        action_id: `remove_item_${idx}`,
        value: JSON.stringify({ index: idx, quote_id: quoteId }),
      },
    });
  });

  blocks.push({ type: "divider" }, {
    type: "header",
    text: { type: "plain_text", text: "➕ Attach Product" },
  });
  blocks.push({
    type: "input",
    block_id: `prod_select_${refreshId}`,
    optional: true,
    element: {
      type: "static_select",
      action_id: "catalog_select",
      placeholder: { type: "plain_text", text: "Select..." },
      options: prodOpts,
    },
    label: { type: "plain_text", text: "Catalog" },
  });
  blocks.push({
    type: "input",
    block_id: `qty_input_${refreshId}`,
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "qty_val",
      placeholder: { type: "plain_text", text: "5" },
    },
    label: { type: "plain_text", text: "Quantity" },
  });

  // THE MANUAL PRICE INPUT:
  blocks.push({
    type: "input",
    block_id: `price_input_${refreshId}`,
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "price_val",
      placeholder: { type: "plain_text", text: "250.00" },
    },
    label: { type: "plain_text", text: "Unit Price ($)" },
  });

  customFieldsConfig.forEach((fBlob: any, idx: number) => {
    if (fBlob.show_on_form) {
      blocks.push({
        type: "input",
        block_id: `item_custom_${idx}_${refreshId}`,
        optional: !fBlob.required,
        element: buildPreFilledElement(fBlob, `item_act_${idx}`, null),
        label: { type: "plain_text", text: fBlob.name || "Spec " + (idx + 1) },
      });
    }
  });

  blocks.push({
    type: "actions",
    elements: [{
      type: "button",
      text: { type: "plain_text", text: "Attach Product" },
      action_id: "edit_add_product_btn",
      style: "primary",
      value: quoteId,
    }],
  });
  return {
    type: "modal",
    callback_id: "finalize_edit_step_two_modal",
    private_metadata: JSON.stringify({
      quote_id: quoteId,
      channel: contextMeta.channel,
      message_ts: contextMeta.message_ts,
      original_ledger: contextMeta.original_ledger,
    }),
    title: { type: "plain_text", text: "Modify Inventory" },
    submit: { type: "plain_text", text: "Save Complete Quote" },
    blocks,
  };
}

export default SlackFunction(
  PostQuoteCardFunction,
  async ({ inputs, client }) => {
    const settingsRes = await client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "schema_quote",
    });
    let rooms = [inputs.sales_rep_id];
    if (settingsRes.ok && settingsRes.item?.broadcast_channels) {
      try {
        rooms = JSON.parse(settingsRes.item.broadcast_channels);
      } catch (e) { /**/ }
    }

    const initialBlocks = await buildLivingQuoteCard(
      client,
      inputs.quote_id,
      inputs.customer_name,
      inputs.total_amount,
      inputs.sales_rep_id,
      false,
    );
    let primaryTs = "";
    for (const r of rooms) {
      const res = await client.chat.postMessage({
        channel: r.trim(),
        blocks: initialBlocks,
        text: "Quote #" + inputs.quote_id + " logged",
      });
      if (res.ok && !primaryTs) primaryTs = res.ts;
    }
    return { completed: false };
  },
)
  .addBlockActionsHandler(
    ["expand_ledger_action"],
    async ({ action, body, client }) => {
      const quoteId = action.value;
      const updatedBlocks = await buildLivingQuoteCard(
        client,
        quoteId,
        "Customer",
        0,
        body.user.id,
        true,
      );
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: updatedBlocks,
        text: "Quote #" + quoteId + " expanded",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["collapse_ledger_action"],
    async ({ action, body, client }) => {
      const quoteId = action.value;
      const updatedBlocks = await buildLivingQuoteCard(
        client,
        quoteId,
        "Customer",
        0,
        body.user.id,
        false,
      );
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: updatedBlocks,
        text: "Quote #" + quoteId + " collapsed",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["edit_quote_action"],
    async ({ action, body, client }) => {
      const qId = action.value;
      const ptr = body.interactivity.interactivity_pointer;
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: qId,
      });
      const metaBlob = qRes.item?.metadata
        ? JSON.parse(qRes.item.metadata)
        : {};
      const schemaRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote",
      });
      const fieldsConfig = schemaRes.item?.custom_fields || [];

      const formBlocks: any[] = [{
        type: "header",
        text: { type: "plain_text", text: "Modify Specs #" + qId },
      }, {
        type: "input",
        block_id: "edit_name_block",
        element: {
          type: "plain_text_input",
          action_id: "name_input",
          initial_value: qRes.item?.name || "",
        },
        label: { type: "plain_text", text: "Record Name" },
      }];
      fieldsConfig.forEach((f, idx) => {
        if (f.show_on_form) {
          formBlocks.push({
            type: "input",
            block_id: `custom_field_${idx}`,
            optional: !f.required,
            element: buildPreFilledElement(
              f,
              `action_${idx}`,
              metaBlob[`custom_field_${idx}`],
            ),
            label: { type: "plain_text", text: f.name || "Field " + (idx + 1) },
          });
        }
      });

      await client.views.open({
        interactivity_pointer: ptr,
        view: {
          type: "modal",
          callback_id: "submit_edit_step_one_modal",
          private_metadata: JSON.stringify({
            quote_id: qId,
            channel: body.container.channel_id,
            message_ts: body.container.message_ts,
            original_ledger: qRes.item?.line_items || "[]",
          }),
          title: { type: "plain_text", text: "Modify Quote (Step 1)" },
          submit: { type: "plain_text", text: "Next: Inventory Ledger" },
          blocks: formBlocks,
        },
      });
      return { completed: false };
    },
  )
  .addViewSubmissionHandler(
    ["submit_edit_step_one_modal"],
    async ({ view, client }) => {
      const meta = JSON.parse(view.private_metadata);
      const vals = view.state.values;
      const newBlob: Record<string, any> = {};
      for (const [bId, aObj] of Object.entries(vals)) {
        if (bId.startsWith("custom_field_")) {
          const aData = (aObj as any)[Object.keys(aObj as object)[0]];
          const val = aData.value || aData.selected_date ||
            aData.selected_time ||
            (aData.selected_option ? aData.selected_option.value : null);
          if (val) newBlob[bId] = val;
        }
      }
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: meta.quote_id,
      });
      if (qRes.ok && qRes.item) {
        qRes.item.name = vals.edit_name_block.name_input.value;
        qRes.item.metadata = JSON.stringify(newBlob);
        await client.apps.datastore.put({
          datastore: QuotesDatastore.name,
          item: qRes.item,
        });
      }
      return {
        response_action: "update",
        view: await buildEditStepTwoView(client, meta.quote_id, meta),
      };
    },
  )
  .addBlockActionsHandler(
    [/^remove_item_.*/],
    async ({ action, body, client }) => {
      const payload = JSON.parse(action.value);
      const vId = body.view?.id;
      const meta = JSON.parse(body.view?.private_metadata || "{}");
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: payload.quote_id,
      });
      if (qRes.ok && qRes.item && vId) {
        const items = JSON.parse(qRes.item.line_items || "[]");
        items.splice(payload.index, 1);
        qRes.item.line_items = JSON.stringify(items);
        await client.apps.datastore.put({
          datastore: QuotesDatastore.name,
          item: qRes.item,
        });
        await client.views.update({
          view_id: vId,
          view: await buildEditStepTwoView(client, payload.quote_id, meta),
        });
      }
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["edit_add_product_btn"],
    async ({ action, body, client }) => {
      const qId = action.value;
      const vId = body.view?.id;
      const vals = body.view?.state.values || {};
      const meta = JSON.parse(body.view?.private_metadata || "{}");
      const schemaRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote_product",
      });
      const lineFields = schemaRes.item?.custom_fields || [];

      let selProd = "none";
      let qty = "1";
      let enteredPrice = "0";
      const specs: Record<string, any> = {};
      for (const [bId, aObj] of Object.entries(vals)) {
        if (bId.startsWith("prod_select_")) {
          selProd = (aObj as any).catalog_select?.selected_option?.value ||
            "none";
        }
        if (bId.startsWith("qty_input_")) {qty = (aObj as any).qty_val?.value ||
            "1";}

        // HARVEST MANUAL PRICE ENTRY:
        if (bId.startsWith("price_input_")) {
          enteredPrice = (aObj as any).price_val?.value || "0";
        }

        if (bId.startsWith("item_custom_")) {
          const fIdx = parseInt(bId.split("_")[2], 10);
          const label = lineFields[fIdx]?.name || "Spec " + (fIdx + 1);
          const aData = (aObj as any)[Object.keys(aObj as object)[0]];
          const val = aData?.value || aData?.selected_date ||
            aData?.selected_time ||
            (aData?.selected_option ? aData.selected_option.value : null);
          if (val) specs[label] = val;
        }
      }
      if (selProd !== "none" && vId) {
        const pRes = await client.apps.datastore.get({
          datastore: ProductsDatastore.name,
          id: selProd,
        });
        const qRes = await client.apps.datastore.get({
          datastore: QuotesDatastore.name,
          id: qId,
        });
        if (qRes.ok && qRes.item) {
          const items = JSON.parse(qRes.item.line_items || "[]");
          // Save negotiated unitPrice into record:
          items.push({
            productId: selProd,
            productName: pRes.item?.name || "Product",
            qty,
            unitPrice: enteredPrice,
            customSpecs: specs,
          });
          qRes.item.line_items = JSON.stringify(items);
          await client.apps.datastore.put({
            datastore: QuotesDatastore.name,
            item: qRes.item,
          });
          await client.views.update({
            view_id: vId,
            view: await buildEditStepTwoView(client, qId, meta),
          });
        }
      }
      return { completed: false };
    },
  )
  .addViewSubmissionHandler(
    ["finalize_edit_step_two_modal"],
    async ({ view, client }) => {
      const meta = JSON.parse(view.private_metadata);
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: meta.quote_id,
      });

      const updatedBlocks = await buildLivingQuoteCard(
        client,
        meta.quote_id,
        "Customer",
        0,
        qRes.item?.sales_rep_id || "Author",
        true,
      );
      await client.chat.update({
        channel: meta.channel,
        ts: meta.message_ts,
        blocks: updatedBlocks,
        text: "Quote #" + meta.quote_id + " updated",
      });

      if (meta.original_ledger !== (qRes.item?.line_items || "[]")) {
        await client.chat.postMessage({
          channel: meta.channel,
          thread_ts: meta.message_ts,
          text: "Inventory ledger successfully updated by <@" +
            (qRes.item?.sales_rep_id || "Rep") + ">.",
        });
      }
      return { response_action: "clear" };
    },
  );
