import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { QuotesDatastore } from "../datastores/quotes.ts";
import { ProductsDatastore } from "../datastores/products.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";
import { AccountsDatastore } from "../datastores/accounts.ts";
import {
  buildApprovalDMBlocks,
  dispatchFreshApprovalDM,
  evaluateCondition,
  getAccountDisplayName,
  processApprovalSubmission,
} from "./approval_controller.ts";

export const PostQuoteCardFunction = DefineFunction({
  callback_id: "post_quote_card",
  title: "Post Quote Card to Broadcast Channels",
  description:
    "Powers living CPQ matrix cards and executes Advanced Approval DMs",
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

// ==========================================
// 1. PUBLIC CARD & TABLE FORMATTERS
// ==========================================

export function formatInCardTable(items: any[], customFieldsSchema: any[]) {
  const tick3 = String.fromCharCode(96, 96, 96);
  if (!items || items.length === 0) {
    return tick3 + "\nNo inventory items attached.\n" + tick3;
  }

  const headers = (customFieldsSchema || []).filter((f: any) =>
    f.show_on_table !== false
  ).map((f: any) => String(f.name || "Spec").toUpperCase());
  const wProd = 15, wQty = 5, wPrice = 9, wCustom = 11, wSub = 10;
  const divider =
    "-".repeat(wProd + wQty + wPrice + (headers.length * wCustom) + wSub) +
    "\n";

  let str = tick3 + "\n" + String("PRODUCT").padEnd(wProd) +
    String("QTY").padStart(wQty) + String("PRICE").padStart(wPrice);
  headers.forEach((h: string) =>
    str += ("  " + h.substring(0, wCustom - 2)).padEnd(wCustom)
  );
  str += String("SUBTOTAL").padStart(wSub) + "\n" + divider;

  let sQty = 0, sTot = 0;
  items.forEach((i: any) => {
    const q = parseInt(i.qty, 10) || 1,
      p = parseFloat(i.unitPrice) || 0,
      sub = q * p;
    sQty += q;
    sTot += sub;
    let rStr =
      String(i.productName || "Item").substring(0, wProd - 2).padEnd(wProd) +
      String(q).padStart(wQty) + ("$" + p.toLocaleString()).padStart(wPrice);
    headers.forEach((h: string) => {
      const mKey = Object.keys(i.customSpecs || {}).find((k) =>
        k.toUpperCase() === h
      );
      const val = mKey ? i.customSpecs[mKey] : "-";
      rStr += ("  " +
        (val !== undefined && val !== null && val !== "" ? String(val) : "-")
          .substring(0, wCustom - 2)).padEnd(wCustom);
    });
    str += rStr + ("$" + sub.toLocaleString()).padStart(wSub) + "\n";
  });

  str += divider + String("TOTALS").padEnd(wProd) +
    String(sQty).padStart(wQty) + "".padEnd(wPrice);
  headers.forEach(() => str += "".padEnd(wCustom));
  return str + ("$" + sTot.toLocaleString()).padStart(wSub) + "\n" + tick3;
}

function buildSafeDynamicInput(field: any, actionId: string, initVal?: any) {
  const safeStr = initVal !== undefined && initVal !== null && initVal !== ""
    ? String(initVal)
    : undefined;
  switch (field.type) {
    case "plain_text_input_multi":
      return {
        type: "plain_text_input",
        action_id: actionId,
        multiline: true,
        initial_value: safeStr,
      };
    case "datepicker":
      return { type: "datepicker", action_id: actionId, initial_date: safeStr };
    case "timepicker":
      return { type: "timepicker", action_id: actionId, initial_time: safeStr };
    case "multi_users_select":
      return { type: "multi_users_select", action_id: actionId };
    case "checkboxes": {
      const rawOptions = (field.dropdown_options?.length > 0)
        ? field.dropdown_options
        : ["No Options Configured"];
      const blockKitCheckboxes = rawOptions.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));
      let initialCheckboxes: any[] = [];
      if (safeStr) {
        initialCheckboxes = blockKitCheckboxes.filter((bOpt) =>
          safeStr.split(",").map((s) => s.trim()).includes(bOpt.value)
        );
      }
      const resObj: any = {
        type: "checkboxes",
        action_id: actionId,
        options: blockKitCheckboxes,
      };
      if (initialCheckboxes.length > 0) {
        resObj.initial_options = initialCheckboxes;
      }
      return resObj;
    }
    case "static_select":
    case "multi_static_select": {
      const rawOptions = (field.dropdown_options?.length > 0)
        ? field.dropdown_options
        : ["No Options Configured"];
      const blockKitOptions = rawOptions.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));
      if (field.type === "static_select") {
        return {
          type: "static_select",
          action_id: actionId,
          placeholder: { type: "plain_text", text: "Select..." },
          options: blockKitOptions,
          initial_option: safeStr
            ? blockKitOptions.find((o) => o.value === safeStr)
            : undefined,
        };
      } else {
        let initialMultiOpts: any[] = [];
        if (safeStr) {
          initialMultiOpts = blockKitOptions.filter((bOpt) =>
            safeStr.split(",").map((s) => s.trim()).includes(bOpt.value)
          );
        }
        const mObj: any = {
          type: "multi_static_select",
          action_id: actionId,
          placeholder: { type: "plain_text", text: "Select..." },
          options: blockKitOptions,
        };
        if (initialMultiOpts.length > 0) {
          mObj.initial_options = initialMultiOpts;
        }
        return mObj;
      }
    }
    case "plain_text_input":
    default:
      return {
        type: "plain_text_input",
        action_id: actionId,
        initial_value: safeStr,
      };
  }
}

async function buildEditStepTwoView(
  client: any,
  quoteId: string,
  channelId: string,
  messageTs: string,
  pristineHash: string,
) {
  const refreshId = Math.floor(Math.random() * 1_000_000);
  const [quoteRes, prodRes, schemaRes] = await Promise.all([
    client.apps.datastore.get({ datastore: QuotesDatastore.name, id: quoteId }),
    client.apps.datastore.query({
      datastore: ProductsDatastore.name,
      expression: "#active = :trueVal",
      expression_attributes: { "#active": "is_active" },
      expression_values: { ":trueVal": true },
    }),
    client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "schema_quote_product",
    }),
  ]);

  const itemsArray = quoteRes.item?.line_items
    ? JSON.parse(quoteRes.item.line_items)
    : [];
  const prodOpts = (prodRes.items || []).slice(0, 100).map((p: any) => ({
    text: { type: "plain_text", text: String(p.name).substring(0, 75) },
    value: String(p.id),
  }));
  if (prodOpts.length === 0) {
    prodOpts.push({
      text: { type: "plain_text", text: "Empty Catalog" },
      value: "none",
    });
  }

  const blocks: any[] = [{
    type: "header",
    text: { type: "plain_text", text: "Modify Inventory #" + quoteId },
  }];
  if (itemsArray.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No inventory attached yet._" },
    });
  } else {
    itemsArray.forEach((item: any, idx: number) => {
      let specPreview = "";
      if (item.customSpecs && Object.keys(item.customSpecs).length > 0) {
        specPreview = "\n   \u21b3 " +
          Object.entries(item.customSpecs).map(([k, v]) => "*" + k + ":* " + v)
            .join(" | ");
      }
      const uPrice = parseFloat(item.unitPrice) || 0;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*" + (idx + 1) + ". " + item.productName + "* | Qty: " +
            item.qty + " (@ $" + uPrice.toLocaleString() + ") - *$" +
            ((parseInt(item.qty, 10) || 1) * uPrice).toLocaleString() + "*" +
            specPreview,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Remove" },
          style: "danger",
          action_id: "remove_edit_line_item_action",
          value: JSON.stringify({
            index: idx,
            quote_id: quoteId,
            channel_id: channelId,
            message_ts: messageTs,
          }),
        },
      });
    });
  }

  blocks.push({ type: "divider" }, {
    type: "section",
    text: { type: "mrkdwn", text: "*Attach a Product*" },
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

  (schemaRes.item?.custom_fields || []).forEach((fBlob: any, idx: number) => {
    if (fBlob.show_on_form) {
      blocks.push({
        type: "input",
        block_id: `item_custom_${idx}_${refreshId}`,
        optional: !fBlob.required,
        element: buildSafeDynamicInput(fBlob, `item_act_${idx}`),
        label: { type: "plain_text", text: fBlob.name || "Spec " + (idx + 1) },
      });
    }
  });

  const packedMeta = JSON.stringify({
    quote_id: quoteId,
    channel_id: channelId,
    message_ts: messageTs,
    pristine_hash: pristineHash,
  });
  blocks.push({
    type: "actions",
    block_id: "edit_modal_footer_actions",
    elements: [{
      type: "button",
      text: { type: "plain_text", text: "Back" },
      action_id: "edit_back_to_step_one_btn",
      value: packedMeta,
    }, {
      type: "button",
      text: { type: "plain_text", text: "Attach Product" },
      action_id: "edit_add_product_btn",
      style: "primary",
      value: packedMeta,
    }],
  });

  return {
    type: "modal",
    callback_id: "finalize_edit_step_two_modal",
    private_metadata: packedMeta,
    title: { type: "plain_text", text: "Modify Inventory" },
    submit: { type: "plain_text", text: "Save" },
    blocks,
  };
}

export async function buildLivingQuoteCard(
  client: any,
  quoteId: string,
  fallbackName: string,
  fallbackTotal: number,
  repId: string,
  isExpanded: boolean,
) {
  const [quoteRes, qSchemaRes, pSchemaRes] = await Promise.all([
    client.apps.datastore.get({ datastore: QuotesDatastore.name, id: quoteId }),
    client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "schema_quote",
    }),
    client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "schema_quote_product",
    }),
  ]);

  const quote = quoteRes.item;
  const safeName = quote?.name || fallbackName;
  const metaBlob = quote?.metadata ? JSON.parse(quote.metadata) : {};
  const itemsArr = quote?.line_items ? JSON.parse(quote.line_items) : [];

  const accountDisplay = await getAccountDisplayName(
    client,
    quote?.description,
  );

  let calcTot = 0;
  itemsArr.forEach((i: any) =>
    calcTot += (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0)
  );
  const formattedTotalDisplay = itemsArr.length > 0
    ? `$${calcTot.toLocaleString()}`
    : `$${fallbackTotal.toLocaleString()} (Estimate - 0 items)`;

  let statusText = "Pending Final Approval";
  if (quote?.approval_status === "APPROVED") statusText = "Fully Approved Deal";
  else if (quote?.approval_status === "REJECTED") statusText = "REJECTED";
  else if (quote?.approval_status === "PENDING_GAUNTLET") {
    const gauntlet = quote?.approval_gauntlet
      ? JSON.parse(quote.approval_gauntlet)
      : [];
    statusText = "Awaiting Step " + ((quote?.current_approval_step || 0) + 1) +
      " of " + gauntlet.length + " (<@" +
      gauntlet[quote?.current_approval_step || 0] + ">)";
  }

  const safeAuthorDisplay = repId && repId !== "undefined" && repId !== "null"
    ? `<@${repId}>`
    : "Author unrecorded";

  const nowTs = Math.floor(Date.now() / 1000);
  const createdTs = metaBlob._sys_created_at || nowTs;
  const updatedTs = metaBlob._sys_updated_at || createdTs;

  const coreGrid = [
    { type: "mrkdwn", text: "*Account:*\n" + accountDisplay },
    { type: "mrkdwn", text: "*Total Value:*\n" + formattedTotalDisplay },
    { type: "mrkdwn", text: "*Status:*\n" + statusText },
    { type: "mrkdwn", text: "*Prepared By:*\n" + safeAuthorDisplay },
    {
      type: "mrkdwn",
      text: "*Create Date:*\n<!date^" + createdTs + "^{date_num}|Date>",
    },
    {
      type: "mrkdwn",
      text: "*Last Modified:*\n<!date^" + updatedTs + "^{date_num}|Date>",
    },
  ];

  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Quote #" + quoteId + " - " + safeName,
      },
    },
    { type: "divider" },
    { type: "section", fields: coreGrid },
  ];

  const cKeys = Object.keys(metaBlob).filter((k) =>
    k.startsWith("custom_field_")
  );
  if (cKeys.length > 0) {
    blocks.push({ type: "divider" }, {
      type: "section",
      text: { type: "mrkdwn", text: "*Macro Specifications:*" },
    });
    cKeys.forEach((k) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*" +
            (qSchemaRes.item?.custom_fields
              ?.[parseInt(k.replace("custom_field_", ""), 10)]?.name ||
              "Spec") +
            ":* " + metaBlob[k],
        },
      });
    });
  }

  if (isExpanded && itemsArr.length > 0) {
    blocks.push({ type: "divider" }, {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Inventory Breakdown (" + itemsArr.length + ")*\n" +
          formatInCardTable(itemsArr, pSchemaRes.item?.custom_fields),
      },
    });
  }

  const actions: any[] = [{
    type: "button",
    text: { type: "plain_text", text: "Edit" },
    style: "primary",
    action_id: "edit_quote_action",
    value: quoteId,
  }];
  if (itemsArr.length > 0) {
    actions.push({
      type: "button",
      text: {
        type: "plain_text",
        text: isExpanded ? "Collapse Table" : "View Details",
      },
      action_id: isExpanded ? "collapse_ledger_action" : "expand_ledger_action",
      value: quoteId,
    });
  }
  blocks.push({ type: "divider" }, { type: "actions", elements: actions });
  return blocks;
}

// ==========================================
// 2. MAIN FUNCTION WORKER
// ==========================================

export default SlackFunction(
  PostQuoteCardFunction,
  async ({ inputs, client }) => {
    try {
      const quoteRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: inputs.quote_id,
      });
      const quote = quoteRes.item;
      if (!quote) return { completed: false };

      quote.sales_rep_id = inputs.sales_rep_id;
      const metaBlob = quote.metadata ? JSON.parse(quote.metadata) : {};
      const itemsArr = quote.line_items ? JSON.parse(quote.line_items) : [];

      const [pSchemaRes, rulesRes] = await Promise.all([
        client.apps.datastore.get({
          datastore: TenantSettingsDatastore.name,
          id: "schema_quote_product",
        }),
        client.apps.datastore.get({
          datastore: TenantSettingsDatastore.name,
          id: "advanced_approval_rules",
        }),
      ]);

      const pSchema = pSchemaRes.item?.custom_fields || [];
      const rawRulesArray = rulesRes.item?.approval_rules
        ? JSON.parse(rulesRes.item.approval_rules)
        : [];

      let compiledGauntlet: string[] = [];
      rawRulesArray.forEach((rule: any) => {
        const conditionsArray: any[] = rule.conditions || [];
        const isTriggered = (rule.match_type === "AND")
          ? conditionsArray.every((c: any) =>
            evaluateCondition(c, quote, itemsArr, metaBlob, pSchema)
          )
          : conditionsArray.some((c: any) =>
            evaluateCondition(c, quote, itemsArr, metaBlob, pSchema)
          );
        if (isTriggered) {
          compiledGauntlet.push(
            ...(Array.isArray(rule.approver_ids)
              ? rule.approver_ids
              : (rule.approver_id ? [rule.approver_id] : [])),
          );
        }
      });

      compiledGauntlet = [...new Set(compiledGauntlet)];

      if (compiledGauntlet.length === 0) {
        quote.approval_status = "APPROVED";
        quote.approval_gauntlet = "[]";
        quote.current_approval_step = 0;
        quote.approval_audit_trail = "[]";
        quote.active_dm_channel = "";
        quote.active_dm_ts = "";
      } else {
        quote.approval_status = "PENDING_GAUNTLET";
        quote.approval_gauntlet = JSON.stringify(compiledGauntlet);
        quote.current_approval_step = 0;
        quote.approval_audit_trail = "[]";
      }

      await client.apps.datastore.put({
        datastore: QuotesDatastore.name,
        item: quote,
      });

      const settingsRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote",
      });
      let rooms: string[] = [];
      if (settingsRes.ok && settingsRes.item?.broadcast_channels) {
        try {
          rooms = JSON.parse(settingsRes.item.broadcast_channels);
        } catch (e) { /**/ }
      }

      const validRooms = (Array.isArray(rooms) && rooms.length > 0)
        ? rooms.map((r: string) => r.trim()).filter(Boolean)
        : [inputs.sales_rep_id];
      const primaryRoom = validRooms[0];
      quote.broadcast_channel_id = primaryRoom;

      const cardBlocks = await buildLivingQuoteCard(
        client,
        inputs.quote_id,
        inputs.customer_name,
        inputs.total_amount,
        inputs.sales_rep_id,
        false,
      );
      const primaryDispatch = await client.chat.postMessage({
        channel: primaryRoom,
        blocks: cardBlocks,
        text: "Quote #" + inputs.quote_id + " logged",
      });

      if (!primaryDispatch.ok) {
        await client.chat.postMessage({
          channel: inputs.sales_rep_id,
          text:
            `SYSTEM ALERT: Failed to post Quote #${inputs.quote_id} to <#${primaryRoom}>. Invite @Spere to room.`,
        });
        return { completed: false };
      }

      const capturedThreadTs = primaryDispatch.ts;
      quote.broadcast_thread_ts = capturedThreadTs;
      const instanceLedger: {
        channel_id: string;
        ts: string;
        is_primary: boolean;
      }[] = [{
        channel_id: primaryRoom,
        ts: capturedThreadTs,
        is_primary: true,
      }];

      if (validRooms.length > 1) {
        const secondaryRooms = validRooms.slice(1);
        const secondaryBlocks = [...cardBlocks, {
          type: "context",
          elements: [{
            type: "mrkdwn",
            text:
              `*Quote Copy:* Official Deal Desk sign-offs tracked in <#${primaryRoom}>.`,
          }],
        }];
        const secondaryDispatches = await Promise.allSettled(
          secondaryRooms.map((targetChan) =>
            client.chat.postMessage({
              channel: targetChan,
              blocks: secondaryBlocks,
              text: `Quote #${inputs.quote_id} Logged`,
            })
          ),
        );
        secondaryDispatches.forEach((receipt, idx) => {
          if (
            receipt.status === "fulfilled" && receipt.value.ok &&
            receipt.value.ts
          ) {
            instanceLedger.push({
              channel_id: secondaryRooms[idx],
              ts: receipt.value.ts,
              is_primary: false,
            });
          }
        });
      }

      quote.card_instances = JSON.stringify(instanceLedger);
      await client.apps.datastore.put({
        datastore: QuotesDatastore.name,
        item: quote,
      });

      if (compiledGauntlet.length > 0) {
        await dispatchFreshApprovalDM(
          client,
          quote,
          compiledGauntlet[0],
          capturedThreadTs,
        );
      }
    } catch (fatalError: any) {
      await client.chat.postMessage({
        channel: inputs.sales_rep_id,
        text: `CRITICAL CRASH: ${fatalError.message || fatalError}`,
      });
    }
    return { completed: false };
  },
)
  // ==========================================
  // 3. PUBLIC TABLE & EDIT INTERACTIVITY
  // ==========================================
  .addBlockActionsHandler(
    ["expand_ledger_action"],
    async ({ action, body, client }) => {
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: await buildLivingQuoteCard(
          client,
          action.value,
          "Customer",
          0,
          body.user.id,
          true,
        ),
        text: "Expanded",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["collapse_ledger_action"],
    async ({ action, body, client }) => {
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: await buildLivingQuoteCard(
          client,
          action.value,
          "Customer",
          0,
          body.user.id,
          false,
        ),
        text: "Collapsed",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["edit_back_to_step_one_btn"],
    async ({ action, body, client }) => {
      const metaContext = JSON.parse(action.value);
      if (!body.view?.id) return { completed: false };
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: metaContext.quote_id,
      });
      const metaBlob = qRes.item?.metadata
        ? JSON.parse(qRes.item.metadata)
        : {};
      const schemaRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote",
      });

      const formBlocks: any[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Modify Specs #" + metaContext.quote_id,
          },
        },
        {
          type: "input",
          block_id: "edit_name_block",
          element: {
            type: "plain_text_input",
            action_id: "name_input",
            initial_value: qRes.item?.name || "Draft Quote",
          },
          label: { type: "plain_text", text: "Record Name" },
        },
      ];

      (schemaRes.item?.custom_fields || []).forEach((f: any, idx: number) => {
        if (f.show_on_form) {
          formBlocks.push({
            type: "input",
            block_id: `custom_field_${idx}`,
            optional: !f.required,
            element: buildSafeDynamicInput(
              f,
              `action_${idx}`,
              metaBlob[`custom_field_${idx}`],
            ),
            label: { type: "plain_text", text: f.name || "Field" },
          });
        }
      });

      await client.views.update({
        view_id: body.view.id,
        view: {
          type: "modal",
          callback_id: "submit_edit_step_one_modal",
          private_metadata: JSON.stringify(metaContext),
          title: { type: "plain_text", text: "Edit" },
          submit: { type: "plain_text", text: "Next" },
          blocks: formBlocks,
        },
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["edit_quote_action"],
    async ({ action, body, client }) => {
      const qId = action.value;
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

      const pristinePayload = JSON.stringify({
        name: qRes.item?.name || "",
        meta: qRes.item?.metadata || "{}",
        items: qRes.item?.line_items || "[]",
      });
      const formBlocks: any[] = [
        {
          type: "header",
          text: { type: "plain_text", text: "Modify Specs #" + qId },
        },
        {
          type: "input",
          block_id: "edit_name_block",
          element: {
            type: "plain_text_input",
            action_id: "name_input",
            initial_value: qRes.item?.name || "Draft Quote",
          },
          label: { type: "plain_text", text: "Record Name" },
        },
      ];

      (schemaRes.item?.custom_fields || []).forEach((f: any, idx: number) => {
        if (f.show_on_form) {
          formBlocks.push({
            type: "input",
            block_id: `custom_field_${idx}`,
            optional: !f.required,
            element: buildSafeDynamicInput(
              f,
              `action_${idx}`,
              metaBlob[`custom_field_${idx}`],
            ),
            label: { type: "plain_text", text: f.name || "Field" },
          });
        }
      });

      const packedMeta = JSON.stringify({
        quote_id: qId,
        channel_id: body.container.channel_id,
        message_ts: body.container.message_ts,
        pristine_hash: pristinePayload,
      });
      await client.views.open({
        interactivity_pointer: body.interactivity.interactivity_pointer,
        view: {
          type: "modal",
          callback_id: "submit_edit_step_one_modal",
          private_metadata: packedMeta,
          title: { type: "plain_text", text: "Edit" },
          submit: { type: "plain_text", text: "Next" },
          blocks: formBlocks,
        },
      });
      return { completed: false };
    },
  )
  .addViewSubmissionHandler(
    ["submit_edit_step_one_modal"],
    async ({ view, client }) => {
      const meta = JSON.parse(view.private_metadata), vals = view.state.values;
      const newBlob: Record<string, any> = {};

      for (const [blockId, actionObj] of Object.entries(vals)) {
        if (blockId.startsWith("custom_field_")) {
          const aData = (actionObj as any)[Object.keys(actionObj as object)[0]];
          const typedVal = aData?.value ?? aData?.selected_date ??
            aData?.selected_time ?? aData?.selected_option?.value ??
            aData?.selected_users?.join(", ") ??
            aData?.selected_options?.map((o: any) => o.value).join(", ");
          if (typedVal) newBlob[blockId] = typedVal;
        }
      }

      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: meta.quote_id,
      });
      if (qRes.ok && qRes.item) {
        const oldMeta = qRes.item.metadata
          ? JSON.parse(qRes.item.metadata)
          : {};

        const mergedMeta = {
          ...oldMeta,
          ...newBlob,
          _sys_updated_at: Math.floor(Date.now() / 1000),
        };
        qRes.item.name = vals.edit_name_block?.name_input?.value ||
          qRes.item.name;
        qRes.item.metadata = JSON.stringify(mergedMeta);
        await client.apps.datastore.put({
          datastore: QuotesDatastore.name,
          item: qRes.item,
        });
      }

      return {
        response_action: "update",
        view: await buildEditStepTwoView(
          client,
          meta.quote_id,
          meta.channel_id,
          meta.message_ts,
          meta.pristine_hash,
        ),
      };
    },
  )
  .addBlockActionsHandler(
    ["remove_edit_line_item_action"],
    async ({ action, body, client }) => {
      const p = JSON.parse(action.value);
      if (!body.view?.id) return { completed: false };
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: p.quote_id,
      });
      if (qRes.ok && qRes.item) {
        const items = JSON.parse(qRes.item.line_items || "[]");
        items.splice(p.index, 1);
        qRes.item.line_items = JSON.stringify(items);

        const metaBlob = qRes.item.metadata
          ? JSON.parse(qRes.item.metadata)
          : {};
        metaBlob._sys_updated_at = Math.floor(Date.now() / 1000);
        qRes.item.metadata = JSON.stringify(metaBlob);

        await client.apps.datastore.put({
          datastore: QuotesDatastore.name,
          item: qRes.item,
        });
        await client.views.update({
          view_id: body.view.id,
          view: await buildEditStepTwoView(
            client,
            p.quote_id,
            p.channel_id,
            p.message_ts,
            p.pristine_hash,
          ),
        });
      }
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["edit_add_product_btn"],
    async ({ action, body, client }) => {
      const metaContext = JSON.parse(action.value),
        vId = body.view?.id,
        vals = body.view?.state.values || {};
      const schemaRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote_product",
      });
      const customFields = schemaRes.item?.custom_fields || [];

      let selProd = "none", qty = "1", price = "0";
      const specs: Record<string, any> = {};

      for (const [bId, aObj] of Object.entries(vals)) {
        if (bId.startsWith("prod_select_")) {
          selProd = (aObj as any).catalog_select?.selected_option?.value ||
            "none";
        }
        if (bId.startsWith("qty_input_")) {
          qty = (aObj as any).qty_val?.value || "1";
        }
        if (bId.startsWith("price_input_")) {
          price = (aObj as any).price_val?.value || "0";
        }
        if (bId.startsWith("item_custom_")) {
          const extVal = (aObj as any)[Object.keys(aObj as object)[0]]?.value ??
            (aObj as any)[Object.keys(aObj as object)[0]]?.selected_option
              ?.value;
          if (extVal) {
            specs[
              customFields[parseInt(bId.split("_")[2], 10)]?.name || "Spec"
            ] = extVal;
          }
        }
      }

      if (selProd !== "none" && vId) {
        const [pRes, qRes] = await Promise.all([
          client.apps.datastore.get({
            datastore: ProductsDatastore.name,
            id: selProd,
          }),
          client.apps.datastore.get({
            datastore: QuotesDatastore.name,
            id: metaContext.quote_id,
          }),
        ]);
        if (qRes.ok && qRes.item) {
          const items = JSON.parse(qRes.item.line_items || "[]");
          items.push({
            productId: selProd,
            productName: pRes.item?.name || "Product",
            qty,
            unitPrice: price,
            customSpecs: specs,
          });
          qRes.item.line_items = JSON.stringify(items);
          await client.apps.datastore.put({
            datastore: QuotesDatastore.name,
            item: qRes.item,
          });
          await client.views.update({
            view_id: vId,
            view: await buildEditStepTwoView(
              client,
              metaContext.quote_id,
              metaContext.channel_id,
              metaContext.message_ts,
              metaContext.pristine_hash,
            ),
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
      const quote = qRes.item;
      if (!quote) return { response_action: "clear" };

      const rep = quote.sales_rep_id || "Quote Author";
      const primaryChan = quote.broadcast_channel_id || meta.channel_id;
      const primaryTs = quote.broadcast_thread_ts || meta.message_ts;

      const activePayload = JSON.stringify({
        name: quote.name || "",
        meta: quote.metadata || "{}",
        items: quote.line_items || "[]",
      });
      const isMutated = meta.pristine_hash !== activePayload;

      const accountDisplay = await getAccountDisplayName(
        client,
        quote.description,
      );

      // 🎯 Flavor A (Middle Dot): Standard Edit
      let editThreadText =
        `<@${rep}> updated Quote #${meta.quote_id} • ${accountDisplay}`;

      if (isMutated) {
        const [pSchemaRes, rulesRes] = await Promise.all([
          client.apps.datastore.get({
            datastore: TenantSettingsDatastore.name,
            id: "schema_quote_product",
          }),
          client.apps.datastore.get({
            datastore: TenantSettingsDatastore.name,
            id: "advanced_approval_rules",
          }),
        ]);
        const pSchema = pSchemaRes.item?.custom_fields || [],
          rawRules = rulesRes.item?.approval_rules
            ? JSON.parse(rulesRes.item.approval_rules)
            : [];

        const metaBlob = quote.metadata ? JSON.parse(quote.metadata) : {};

        metaBlob._sys_updated_at = Math.floor(Date.now() / 1000);
        quote.metadata = JSON.stringify(metaBlob);

        const itemsArr = quote.line_items ? JSON.parse(quote.line_items) : [];
        let newGauntlet: string[] = [];
        rawRules.forEach((rule: any) => {
          const isTriggered = (rule.match_type === "AND")
            ? (rule.conditions || []).every((c: any) =>
              evaluateCondition(c, quote, itemsArr, metaBlob, pSchema)
            )
            : (rule.conditions || []).some((c: any) =>
              evaluateCondition(c, quote, itemsArr, metaBlob, pSchema)
            );
          if (isTriggered) {
            newGauntlet.push(
              ...(Array.isArray(rule.approver_ids)
                ? rule.approver_ids
                : (rule.approver_id ? [rule.approver_id] : [])),
            );
          }
        });

        newGauntlet = [...new Set(newGauntlet)];
        const auditTrail = quote.approval_audit_trail
          ? JSON.parse(quote.approval_audit_trail)
          : [];

        if (newGauntlet.length === 0) {
          quote.approval_status = "APPROVED";
          quote.approval_gauntlet = "[]";
          quote.current_approval_step = 0;
          quote.active_dm_channel = "";
          quote.active_dm_ts = "";

          // 🎯 Flavor A (Middle Dot): Auto Approval
          editThreadText =
            `<@${rep}> updated Quote #${meta.quote_id} • ${accountDisplay}\n> *The deal now aligns within approval parameters*`;

          await client.apps.datastore.put({
            datastore: QuotesDatastore.name,
            item: quote,
          });
        } else {
          const existingCollarChan = quote.active_dm_channel,
            existingCollarTs = quote.active_dm_ts;
          let safeTier = quote.current_approval_step || 0;
          if (safeTier >= newGauntlet.length) safeTier = 0;
          const targetApprover = newGauntlet[safeTier];

          if (quote.approval_status === "PENDING_GAUNTLET") {
            quote.approval_gauntlet = JSON.stringify(newGauntlet);
            quote.current_approval_step = safeTier;
            auditTrail.push({
              approver_id: rep,
              decision: "EDIT_IN_FLIGHT",
              note: `Specs amended mid-review. Refreshed Step ${safeTier + 1}.`,
              timestamp: Math.floor(Date.now() / 1000),
            });
            quote.approval_audit_trail = JSON.stringify(auditTrail);

            // 🎯 Flavor A (Middle Dot): Escalated during review
            editThreadText =
              `<@${rep}> updated Quote #${meta.quote_id} • ${accountDisplay}\n> *The deal now aligns within approval parameters*`;

            await client.apps.datastore.put({
              datastore: QuotesDatastore.name,
              item: quote,
            });

            if (existingCollarChan && existingCollarTs && targetApprover) {
              const refreshedDmBlocks = await buildApprovalDMBlocks(
                client,
                meta.quote_id,
                primaryTs,
                false,
              );
              if (refreshedDmBlocks) {
                await client.chat.update({
                  channel: existingCollarChan,
                  ts: existingCollarTs,
                  blocks: refreshedDmBlocks,
                  text: `Approval #${meta.quote_id} refreshed`,
                });
              }
            } else if (targetApprover) {
              await dispatchFreshApprovalDM(
                client,
                quote,
                targetApprover,
                primaryTs,
              );
            }
          } else {
            quote.approval_status = "PENDING_GAUNTLET";
            quote.approval_gauntlet = JSON.stringify(newGauntlet);
            quote.current_approval_step = 0;
            auditTrail.push({
              approver_id: rep,
              decision: "ESCALATE",
              note:
                "Amendments crossed Deal Desk thresholds. Initiating Step 1.",
              timestamp: Math.floor(Date.now() / 1000),
            });
            quote.approval_audit_trail = JSON.stringify(auditTrail);

            // 🎯 Flavor A (Middle Dot): Escalate into review
            editThreadText =
              `<@${rep}> updated Quote #${meta.quote_id} • ${accountDisplay}\n> *The deal now aligns within approval parameters*`;

            await client.apps.datastore.put({
              datastore: QuotesDatastore.name,
              item: quote,
            });

            if (newGauntlet[0]) {
              await dispatchFreshApprovalDM(
                client,
                quote,
                newGauntlet[0],
                primaryTs,
              );
            }
          }
        }
      }

      const instancesToUpdate = quote.card_instances
        ? JSON.parse(quote.card_instances)
        : [{ channel_id: primaryChan, ts: primaryTs, is_primary: true }];
      const updatedBlocksPrimary = await buildLivingQuoteCard(
        client,
        meta.quote_id,
        quote.name,
        0,
        rep,
        false,
      );
      const updatedBlocksSecondary = [...updatedBlocksPrimary, {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `*Quote Copy:* Tracked in <#${primaryChan}>.`,
        }],
      }];

      const apiOps = instancesToUpdate.map((inst: any) =>
        client.chat.update({
          channel: inst.channel_id,
          ts: inst.ts,
          blocks: inst.is_primary
            ? updatedBlocksPrimary
            : updatedBlocksSecondary,
          text: `Quote #${meta.quote_id} Updated`,
        })
      );
      apiOps.push(
        client.chat.postMessage({
          channel: primaryChan,
          thread_ts: primaryTs,
          text: editThreadText, // 🎯 Applies Flavor A dynamically
        }),
      );
      await Promise.allSettled(apiOps);

      return { response_action: "clear" };
    },
  )
  .addBlockActionsHandler(
    ["catalog_select", "qty_val", "price_val"],
    async () => ({ completed: false }),
  )
  // ==========================================
  // 4. APPROVAL INTERACTIVITY ROUTER
  // ==========================================
  .addBlockActionsHandler(
    ["dm_expand_ledger"],
    async ({ action, body, client }) => {
      const state = JSON.parse(action.value);
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: await buildApprovalDMBlocks(
          client,
          state.quote_id,
          state.thread_ts,
          true,
        ),
        text: "Expanded",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["dm_collapse_ledger"],
    async ({ action, body, client }) => {
      const state = JSON.parse(action.value);
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: await buildApprovalDMBlocks(
          client,
          state.quote_id,
          state.thread_ts,
          false,
        ),
        text: "Collapsed",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["approve_step_btn", "reject_step_btn"],
    async ({ action, body, client }) => {
      const stateContext = JSON.parse(action.value),
        isApprove = action.action_id === "approve_step_btn";
      await client.views.open({
        interactivity_pointer: body.interactivity.interactivity_pointer,
        view: {
          type: "modal",
          callback_id: "approval_decision_modal",
          private_metadata: JSON.stringify({
            quote_id: stateContext.quote_id,
            thread_ts: stateContext.thread_ts,
            decision: isApprove ? "APPROVE" : "REJECT",
            dm_channel_id: body.container.channel_id,
            dm_message_ts: body.container.message_ts,
          }),
          title: { type: "plain_text", text: isApprove ? "Approve" : "Reject" },
          submit: {
            type: "plain_text",
            text: isApprove ? "Approve" : "Reject",
          },
          close: { type: "plain_text", text: "Cancel" },
          blocks: [{
            type: "header",
            text: {
              type: "plain_text",
              text: `${
                isApprove ? "Approve" : "Reject"
              } Quote #${stateContext.quote_id}`,
            },
          }, {
            type: "input",
            block_id: "audit_note_block",
            element: {
              type: "plain_text_input",
              action_id: "note_input",
              multiline: true,
            },
            label: { type: "plain_text", text: "Audit Notes" },
          }],
        },
      });
      return { completed: false };
    },
  )
  .addViewSubmissionHandler(
    ["approval_decision_modal"],
    async ({ view, body, client }) => {
      return await processApprovalSubmission({ view, body, client });
    },
  );
