import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { QuotesDatastore } from "../datastores/quotes.ts";
import { ProductsDatastore } from "../datastores/products.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const PostQuoteCardFunction = DefineFunction({
  callback_id: "post_quote_card",
  title: "Post Quote Card to Broadcast Channels",
  description:
    "Powers the living CPQ matrix card and executes the Advanced Approval DM State Machine",
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

function testOperator(
  actualVal: any,
  operator: string,
  targetVal: string,
): boolean {
  if (actualVal === undefined || actualVal === null) return false;
  const aStr = String(actualVal).trim();
  const tStr = String(targetVal).trim();
  const aNum = parseFloat(actualVal) || 0;
  const tNum = parseFloat(targetVal) || 0;
  switch (operator) {
    case "EQ":
      return aStr.toLowerCase() === tStr.toLowerCase();
    case "CONTAINS":
      return aStr.toLowerCase().includes(tStr.toLowerCase());
    case "CONTAINS_EXACT":
      return aStr.includes(tStr);
    case "GT":
      return aNum > tNum;
    case "LT":
      return aNum < tNum;
    default:
      return false;
  }
}

function evaluateCondition(
  cond: any,
  quoteObj: any,
  lineItemsArr: any[],
  metaBlob: Record<string, any>,
  prodSchema: any[],
): boolean {
  const { field_ref, operator, target_val } = cond;
  if (field_ref === "quote.total_amount") {
    let calc = 0;
    lineItemsArr.forEach((i: any) => {
      calc += (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0);
    });
    return testOperator(calc, operator, target_val);
  }
  if (field_ref === "quote.customer_name") {
    return testOperator(quoteObj.name, operator, target_val);
  }
  if (field_ref.startsWith("quote.custom_field_")) {
    return testOperator(
      metaBlob[field_ref.replace("quote.", "")],
      operator,
      target_val,
    );
  }
  if (field_ref.startsWith("product.item_custom_")) {
    const targetSpecLabel = prodSchema[parseInt(field_ref.split("_")[2], 10)]
      ?.name;
    if (!targetSpecLabel) return false;
    return lineItemsArr.some((item: any) =>
      testOperator(item.customSpecs?.[targetSpecLabel], operator, target_val)
    );
  }
  return false;
}

function formatInCardTable(items: any[], customFieldsSchema: any[]) {
  const tick3 = String.fromCharCode(96, 96, 96);
  if (!items || items.length === 0) {
    return tick3 + "\nNo inventory items attached.\n" + tick3;
  }

  const headers = (customFieldsSchema || []).filter((f: any) =>
    f.show_on_table !== false
  ).map((f: any) => String(f.name || "Spec").toUpperCase());
  const wProd = 15;
  const wQty = 5;
  const wPrice = 9;
  const wCustom = 11;
  const wSub = 10;
  const totalW = wProd + wQty + wPrice + (headers.length * wCustom) + wSub;
  const divider = "-".repeat(totalW) + "\n";

  let str = tick3 + "\n" + String("PRODUCT").padEnd(wProd) +
    String("QTY").padStart(wQty) + String("PRICE").padStart(wPrice);
  headers.forEach((h: string) => {
    str += ("  " + h.substring(0, wCustom - 2)).padEnd(wCustom);
  });
  str += String("SUBTOTAL").padStart(wSub) + "\n" + divider;

  let sQty = 0;
  let sTot = 0;
  items.forEach((i: any) => {
    const q = parseInt(i.qty, 10) || 1;
    const p = parseFloat(i.unitPrice) || 0;
    const sub = q * p;
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
  headers.forEach(() => {
    str += "".padEnd(wCustom);
  });
  return str + ("$" + sTot.toLocaleString()).padStart(wSub) + "\n" + tick3;
}

// 🛡️ SUPERCHARGED BUILDER: Resolves both schemas and statefully re-checks saved boxes
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
      return {
        type: "datepicker",
        action_id: actionId,
        initial_date: safeStr ? safeStr : undefined,
      };
    case "timepicker":
      return {
        type: "timepicker",
        action_id: actionId,
        initial_time: safeStr ? safeStr : undefined,
      };
    case "multi_users_select":
      return { type: "multi_users_select", action_id: actionId };

    // 🎯 GENERATION 2: Physical Checkboxes with saved-state hydration
    case "checkboxes": {
      const rawOptions =
        (field.dropdown_options && field.dropdown_options.length > 0)
          ? field.dropdown_options
          : ["No Options Configured"];
      const blockKitCheckboxes = rawOptions.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));

      let initialCheckboxes: any[] = [];
      if (safeStr) {
        const savedArr = safeStr.split(",").map((s) => s.trim());
        initialCheckboxes = blockKitCheckboxes.filter((bOpt) =>
          savedArr.includes(bOpt.value)
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

    // 🎯 GENERATION 1: Multi-Select Dropdowns with saved-state hydration
    case "static_select":
    case "multi_static_select": {
      const rawOptions =
        (field.dropdown_options && field.dropdown_options.length > 0)
          ? field.dropdown_options
          : ["No Options Configured"];
      const blockKitOptions = rawOptions.map((opt: string) => ({
        text: { type: "plain_text", text: String(opt).substring(0, 75) },
        value: String(opt).substring(0, 75),
      }));

      if (field.type === "static_select") {
        const initOpt = safeStr
          ? blockKitOptions.find((o) => o.value === safeStr)
          : undefined;
        return {
          type: "static_select",
          action_id: actionId,
          placeholder: { type: "plain_text", text: "Select..." },
          options: blockKitOptions,
          initial_option: initOpt,
        };
      } else {
        let initialMultiOpts: any[] = [];
        if (safeStr) {
          const savedArr = safeStr.split(",").map((s) => s.trim());
          initialMultiOpts = blockKitOptions.filter((bOpt) =>
            savedArr.includes(bOpt.value)
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

// ⚡ SPEED FIX: Fetching DataStores concurrently via Promise.all
async function buildEditStepTwoView(
  client: any,
  quoteId: string,
  channelId: string,
  messageTs: string,
) {
  const refreshId = Math.floor(Math.random() * 1_000_000);

  const [quoteRes, prodRes, schemaRes] = await Promise.all([
    client.apps.datastore.get({ datastore: QuotesDatastore.name, id: quoteId }),
    client.apps.datastore.query({ datastore: ProductsDatastore.name }),
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
      text: { type: "plain_text", text: "Empty" },
      value: "none",
    });
  }

  const customFieldsConfig = schemaRes.item?.custom_fields || [];

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
      const subCalc = (parseInt(item.qty, 10) || 1) * uPrice;

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*" + (idx + 1) + ". " + item.productName + "* | Qty: " +
            item.qty + " (@ $" + uPrice.toLocaleString() + ") - *$" +
            subCalc.toLocaleString() + "*" + specPreview,
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

  customFieldsConfig.forEach((fBlob: any, idx: number) => {
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
  });

  blocks.push({
    type: "actions",
    block_id: "edit_modal_footer_actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Back" },
        action_id: "edit_back_to_step_one_btn",
        value: packedMeta,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Attach Product" },
        action_id: "edit_add_product_btn",
        style: "primary",
        value: packedMeta,
      },
    ],
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

// ⚡ SPEED FIX: Fetching DataStores concurrently via Promise.all
async function buildLivingQuoteCard(
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

  let calcTot = 0;
  itemsArr.forEach((i: any) => {
    calcTot += (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0);
  });

  const formattedTotalDisplay = itemsArr.length > 0
    ? `$${calcTot.toLocaleString()}`
    : `$${fallbackTotal.toLocaleString()} (Macro Estimate - 0 items attached)`;

  let statusText = "Pending Final Approval";
  if (quote?.approval_status === "APPROVED") statusText = "Fully Approved Deal";
  else if (quote?.approval_status === "REJECTED") statusText = "REJECTED";
  else if (quote?.approval_status === "PENDING_GAUNTLET") {
    const gauntlet = quote?.approval_gauntlet
      ? JSON.parse(quote.approval_gauntlet)
      : [];
    const curIdx = quote?.current_approval_step || 0;
    statusText = "Awaiting Step " + (curIdx + 1) + " of " + gauntlet.length +
      " (<@" + gauntlet[curIdx] + ">)";
  }

  const safeAuthorDisplay = repId && repId !== "undefined" && repId !== "null"
    ? `<@${repId}>`
    : "Author unrecorded";

  const coreGrid = [
    { type: "mrkdwn", text: "*Total Value:*\n" + formattedTotalDisplay },
    { type: "mrkdwn", text: "*Status:*\n" + statusText },
    { type: "mrkdwn", text: "*Prepared By:*\n" + safeAuthorDisplay },
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
      const idx = parseInt(k.replace("custom_field_", ""), 10);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*" + (qSchemaRes.item?.custom_fields?.[idx]?.name || "Spec") +
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

// ⚡ SPEED FIX: Fetching DataStores concurrently via Promise.all
async function buildApprovalDMBlocks(
  client: any,
  quoteId: string,
  threadTs: string,
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
  if (!quote) return null;

  const metaBlob = quote.metadata ? JSON.parse(quote.metadata) : {};
  const itemsArr = quote.line_items ? JSON.parse(quote.line_items) : [];
  const auditTrail = quote.approval_audit_trail
    ? JSON.parse(quote.approval_audit_trail)
    : [];
  let calcTot = 0;
  itemsArr.forEach((i: any) => {
    calcTot += (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0);
  });

  const safeAuthorDisplay = quote.sales_rep_id
    ? `<@${quote.sales_rep_id}>`
    : "Author unrecorded";

  const coreGrid = [
    { type: "mrkdwn", text: "*Total Value:*\n$" + calcTot.toLocaleString() },
    { type: "mrkdwn", text: "*Status:*\nMandated Executive Review" },
    { type: "mrkdwn", text: "*Prepared By:*\n" + safeAuthorDisplay },
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
        text: "APPROVAL REQUIRED: #" + quoteId + " - " + quote.name,
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
      const idx = parseInt(k.replace("custom_field_", ""), 10);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*" + (qSchemaRes.item?.custom_fields?.[idx]?.name || "Spec") +
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
        text: "*Itemized Inventory Breakdown (" + itemsArr.length + ")*\n" +
          formatInCardTable(itemsArr, pSchemaRes.item?.custom_fields),
      },
    });
  }

  if (auditTrail.length > 0) {
    blocks.push({ type: "divider" }, {
      type: "section",
      text: { type: "mrkdwn", text: "*Prior Audit Trail:*" },
    });
    auditTrail.forEach((entry: any, idx: number) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Step ${idx + 1} (<@${entry.approver_id}>):* "${entry.note}"`,
        },
      });
    });
  }

  const gauntlet = quote.approval_gauntlet
    ? JSON.parse(quote.approval_gauntlet)
    : [];
  const curStep = quote.current_approval_step || 0;
  const packedState = JSON.stringify({
    quote_id: quoteId,
    thread_ts: threadTs,
  });

  blocks.push(
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Execution Relay:* You are Step " + (curStep + 1) + " of " +
          gauntlet.length + " in the mandated deal desk sign-off chain.",
      },
    },
  );

  const dmActions: any[] = [];
  if (itemsArr.length > 0) {
    dmActions.push({
      type: "button",
      text: {
        type: "plain_text",
        text: isExpanded ? "Collapse Table" : "View Details",
      },
      action_id: isExpanded ? "dm_collapse_ledger" : "dm_expand_ledger",
      value: packedState,
    });
  }
  dmActions.push(
    {
      type: "button",
      text: { type: "plain_text", text: "Approve" },
      style: "primary",
      action_id: "approve_step_btn",
      value: packedState,
    },
    {
      type: "button",
      text: { type: "plain_text", text: "Reject" },
      style: "danger",
      action_id: "reject_step_btn",
      value: packedState,
    },
  );

  blocks.push({ type: "actions", elements: dmActions });
  return blocks;
}

async function dispatchApprovalDM(
  client: any,
  quoteId: string,
  targetApproverId: string,
  threadTs: string,
) {
  const blocks = await buildApprovalDMBlocks(client, quoteId, threadTs, false);
  if (!blocks) return null;
  return await client.chat.postMessage({
    channel: targetApproverId,
    blocks,
    text: "Approval requested for #" + quoteId,
  });
}

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
      const pSchemaRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote_product",
      });
      const pSchema = pSchemaRes.item?.custom_fields || [];

      const rulesRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "advanced_approval_rules",
      });
      const rawRulesArray = rulesRes.item?.approval_rules
        ? JSON.parse(rulesRes.item.approval_rules)
        : [];

      let compiledGauntlet: string[] = [];
      rawRulesArray.forEach((rule: any) => {
        const conditionsArray: any[] = rule.conditions || [];
        const isAnd = rule.match_type === "AND";
        const isTriggered = isAnd
          ? conditionsArray.every((c) =>
            evaluateCondition(c, quote, itemsArr, metaBlob, pSchema)
          )
          : conditionsArray.some((c) =>
            evaluateCondition(c, quote, itemsArr, metaBlob, pSchema)
          );
        if (isTriggered) {
          const stepApprovers =
            rule.approver_ids && Array.isArray(rule.approver_ids)
              ? rule.approver_ids
              : (rule.approver_id ? [rule.approver_id] : []);
          compiledGauntlet.push(...stepApprovers);
        }
      });

      compiledGauntlet = [...new Set(compiledGauntlet)];

      if (compiledGauntlet.length === 0) {
        quote.approval_status = "APPROVED";
        quote.approval_gauntlet = "[]";
        quote.current_approval_step = 0;
        quote.approval_audit_trail = "[]";
      } else {
        quote.approval_status = "PENDING_GAUNTLET";
        quote.approval_gauntlet = JSON.stringify(compiledGauntlet);
        quote.current_approval_step = 0;
        quote.approval_audit_trail = "[]";
      }

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

      const targetedBroadcastChannel = rooms[0]
        ? rooms[0].trim()
        : inputs.sales_rep_id;
      quote.broadcast_channel_id = targetedBroadcastChannel;

      const cardBlocks = await buildLivingQuoteCard(
        client,
        inputs.quote_id,
        inputs.customer_name,
        inputs.total_amount,
        inputs.sales_rep_id,
        false,
      );
      const dispatchRes = await client.chat.postMessage({
        channel: targetedBroadcastChannel,
        blocks: cardBlocks,
        text: "Quote #" + inputs.quote_id + " logged",
      });

      if (!dispatchRes.ok) {
        await client.chat.postMessage({
          channel: inputs.sales_rep_id,
          text:
            `SYSTEM ALERT: Failed to post Quote #${inputs.quote_id} to <#${targetedBroadcastChannel}>. Please type /invite @Spere inside that room.`,
        });
        return { completed: false };
      }

      const capturedThreadTs = dispatchRes.ts;
      quote.broadcast_thread_ts = capturedThreadTs;
      await client.apps.datastore.put({
        datastore: QuotesDatastore.name,
        item: quote,
      });

      if (compiledGauntlet.length > 0) {
        await dispatchApprovalDM(
          client,
          inputs.quote_id,
          compiledGauntlet[0],
          capturedThreadTs,
        );
      }
    } catch (fatalError: any) {
      await client.chat.postMessage({
        channel: inputs.sales_rep_id,
        text: `CRITICAL WORKER CRASH: Runtime threw: ${
          fatalError.message || fatalError
        }`,
      });
    }

    return { completed: false };
  },
)
  .addBlockActionsHandler(
    ["expand_ledger_action"],
    async ({ action, body, client }) => {
      const updatedBlocks = await buildLivingQuoteCard(
        client,
        action.value,
        "Customer",
        0,
        body.user.id,
        true,
      );
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: updatedBlocks,
        text: "Expanded",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["collapse_ledger_action"],
    async ({ action, body, client }) => {
      const updatedBlocks = await buildLivingQuoteCard(
        client,
        action.value,
        "Customer",
        0,
        body.user.id,
        false,
      );
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: updatedBlocks,
        text: "Collapsed",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["dm_expand_ledger"],
    async ({ action, body, client }) => {
      const state = JSON.parse(action.value);
      const updatedBlocks = await buildApprovalDMBlocks(
        client,
        state.quote_id,
        state.thread_ts,
        true,
      );
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: updatedBlocks,
        text: "Approval requested",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["dm_collapse_ledger"],
    async ({ action, body, client }) => {
      const state = JSON.parse(action.value);
      const updatedBlocks = await buildApprovalDMBlocks(
        client,
        state.quote_id,
        state.thread_ts,
        false,
      );
      await client.chat.update({
        channel: body.container.channel_id,
        ts: body.container.message_ts,
        blocks: updatedBlocks,
        text: "Approval requested",
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["edit_back_to_step_one_btn"],
    async ({ action, body, client }) => {
      const metaContext = JSON.parse(action.value);
      const vId = body.view?.id;
      if (!vId) return { completed: false };

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
      const customFields = schemaRes.item?.custom_fields || [];

      const safeName = (qRes.item?.name && qRes.item.name !== "")
        ? qRes.item.name
        : "Draft Quote";
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
            initial_value: safeName,
          },
          label: { type: "plain_text", text: "Record Name" },
        },
      ];

      customFields.forEach((f: any, idx: number) => {
        if (f.show_on_form) {
          const savedValue = metaBlob[`custom_field_${idx}`] || undefined;
          formBlocks.push({
            type: "input",
            block_id: `custom_field_${idx}`,
            optional: !f.required,
            element: buildSafeDynamicInput(f, `action_${idx}`, savedValue),
            label: { type: "plain_text", text: f.name || "Field" },
          });
        }
      });

      await client.views.update({
        view_id: vId,
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

      const safeName = (qRes.item?.name && qRes.item.name !== "")
        ? qRes.item.name
        : "Draft Quote";
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
            initial_value: safeName,
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
      });
      await client.views.open({
        interactivity_pointer: ptr,
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
      const meta = JSON.parse(view.private_metadata);
      const vals = view.state.values;
      const newBlob: Record<string, any> = {};

      for (const [blockId, actionObj] of Object.entries(vals)) {
        if (blockId.startsWith("custom_field_")) {
          const aData = (actionObj as any)[Object.keys(actionObj as object)[0]];
          let typedVal = null;
          if (aData?.value) typedVal = aData.value;
          else if (aData?.selected_date) typedVal = aData.selected_date;
          else if (aData?.selected_time) typedVal = aData.selected_time;
          else if (aData?.selected_users) {
            typedVal = aData.selected_users.join(
              ", ",
            );
          } else if (aData?.selected_option) {
            typedVal = aData.selected_option.value;
          } else if (aData?.selected_options) {
            typedVal = aData.selected_options.map((o: any) => o.value).join(
              ", ",
            );
          }
          if (typedVal) newBlob[blockId] = typedVal;
        }
      }

      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: meta.quote_id,
      });
      if (qRes.ok && qRes.item) {
        const updatedName = vals.edit_name_block?.name_input?.value ||
          qRes.item.name || "Draft Quote";
        qRes.item.name = updatedName;
        qRes.item.metadata = JSON.stringify(newBlob);
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
        ),
      };
    },
  )
  .addBlockActionsHandler(
    ["remove_edit_line_item_action"],
    async ({ action, body, client }) => {
      const p = JSON.parse(action.value);
      const vId = body.view?.id;
      if (!vId) return { completed: false };
      const qRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: p.quote_id,
      });
      if (qRes.ok && qRes.item) {
        const items = JSON.parse(qRes.item.line_items || "[]");
        items.splice(p.index, 1);
        qRes.item.line_items = JSON.stringify(items);
        await client.apps.datastore.put({
          datastore: QuotesDatastore.name,
          item: qRes.item,
        });
        await client.views.update({
          view_id: vId,
          view: await buildEditStepTwoView(
            client,
            p.quote_id,
            p.channel_id,
            p.message_ts,
          ),
        });
      }
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["edit_add_product_btn"],
    async ({ action, body, client }) => {
      const metaContext = JSON.parse(action.value);
      const vId = body.view?.id;
      const vals = body.view?.state.values || {};
      const schemaRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote_product",
      });
      const customFields = schemaRes.item?.custom_fields || [];

      let selProd = "none";
      let qty = "1";
      let price = "0";
      const specs: Record<string, any> = {};

      for (const [bId, aObj] of Object.entries(vals)) {
        if (bId.startsWith("prod_select_")) {
          selProd = (aObj as any).catalog_select?.selected_option?.value ||
            (aObj as any).product_select?.selected_option?.value || "none";
        }
        if (bId.startsWith("qty_input_")) {
          qty = (aObj as any).qty_val?.value ||
            (aObj as any).qty_input?.value || "1";
        }
        if (bId.startsWith("price_input_")) {
          price = (aObj as any).price_val?.value ||
            (aObj as any).unit_price_input?.value || "0";
        }

        if (bId.startsWith("item_custom_")) {
          const fIdx = parseInt(bId.split("_")[2], 10);
          const configuredLabel = customFields[fIdx]?.name ||
            "Spec " + (fIdx + 1);
          const aData = (aObj as any)[Object.keys(aObj as object)[0]];

          // 🎯 HARVESTER DEFENSE: Safely catches plural arrays during inventory modifications
          const extVal = aData?.value ?? aData?.selected_date ??
            aData?.selected_time ??
            (aData?.selected_option ? aData.selected_option.value : null) ??
            (aData?.selected_options
              ? aData.selected_options.map((o: any) => o.value).join(", ")
              : null);

          if (extVal) specs[configuredLabel] = extVal;
        }
      }

      if (selProd !== "none" && vId) {
        const pRes = await client.apps.datastore.get({
          datastore: ProductsDatastore.name,
          id: selProd,
        });
        const qRes = await client.apps.datastore.get({
          datastore: QuotesDatastore.name,
          id: metaContext.quote_id,
        });
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
            ),
          });
        }
      }
      return { completed: false };
    },
  )
  // ⚡ SPEED FIX: Concurrent View Updates & Slack Post Messages
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
      const targetChan = quote.broadcast_channel_id || meta.channel_id;
      const targetTs = quote.broadcast_thread_ts || meta.message_ts;

      const updatedBlocks = await buildLivingQuoteCard(
        client,
        meta.quote_id,
        quote.name,
        0,
        rep,
        false,
      );

      // Execute multiple API updates simultaneously to completely evade the 3.0s Modal Timeout
      await Promise.all([
        client.chat.update({
          channel: targetChan,
          ts: targetTs,
          blocks: updatedBlocks,
          text: "Updated Quote Ledger",
        }),
        client.chat.postMessage({
          channel: targetChan,
          thread_ts: targetTs,
          text:
            `[INVENTORY UPDATED] <@${rep}> successfully committed product ledger modifications for Quote #${meta.quote_id}.`,
        }),
      ]);

      return { response_action: "clear" };
    },
  )
  .addBlockActionsHandler(
    ["approve_step_btn", "reject_step_btn"],
    async ({ action, body, client }) => {
      const stateContext = JSON.parse(action.value);
      const isApprove = action.action_id === "approve_step_btn";
      const decision = isApprove ? "APPROVE" : "REJECT";
      const modalTitle = isApprove ? "Approve Quote" : "Reject Quote";
      const headerText = isApprove
        ? "Approve Quote #" + stateContext.quote_id
        : "Reject Quote #" + stateContext.quote_id;
      const submitText = isApprove ? "Approve" : "Reject";
      const labelNote = isApprove
        ? "Mandatory Approval Notes"
        : "Mandatory Rejection Notes";

      await client.views.open({
        interactivity_pointer: body.interactivity.interactivity_pointer,
        view: {
          type: "modal",
          callback_id: "approval_decision_modal",
          private_metadata: JSON.stringify({
            quote_id: stateContext.quote_id,
            thread_ts: stateContext.thread_ts,
            decision,
            dm_channel_id: body.container.channel_id,
            dm_message_ts: body.container.message_ts,
          }),
          title: { type: "plain_text", text: modalTitle },
          submit: { type: "plain_text", text: submitText },
          close: { type: "plain_text", text: "Cancel" },
          blocks: [
            { type: "header", text: { type: "plain_text", text: headerText } },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  "Please provide your reasoning. This audit trail will be logged natively into the channel thread.",
              },
            },
            {
              type: "input",
              block_id: "audit_note_block",
              optional: false,
              element: {
                type: "plain_text_input",
                action_id: "note_input",
                multiline: true,
                placeholder: {
                  type: "plain_text",
                  text: "Type your official audit notes here...",
                },
              },
              label: { type: "plain_text", text: labelNote },
            },
          ],
        },
      });
      return { completed: false };
    },
  )
  // ⚡ SPEED FIX: Heavy Parallelization prevents the dreaded 3.0s Slack timeout loop!
  .addViewSubmissionHandler(
    ["approval_decision_modal"],
    async ({ view, body, client }) => {
      const meta = JSON.parse(view.private_metadata);
      const { quote_id, thread_ts, decision, dm_channel_id, dm_message_ts } =
        meta;
      const auditNote = view.state.values.audit_note_block.note_input.value ||
        "No note provided.";

      const quoteRes = await client.apps.datastore.get({
        datastore: QuotesDatastore.name,
        id: quote_id,
      });
      const quote = quoteRes.item;
      if (!quote) return { response_action: "clear" };

      const targetThreadTs = thread_ts ?? quote.broadcast_thread_ts;
      const targetChannelId = quote.broadcast_channel_id ?? dm_channel_id;

      const gauntlet: string[] = quote.approval_gauntlet
        ? JSON.parse(quote.approval_gauntlet)
        : [];
      const curStep = quote.current_approval_step || 0;
      const auditTrail: any[] = quote.approval_audit_trail
        ? JSON.parse(quote.approval_audit_trail)
        : [];

      auditTrail.push({
        approver_id: body.user.id,
        decision,
        note: auditNote,
        timestamp: Math.floor(Date.now() / 1000),
      });
      quote.approval_audit_trail = JSON.stringify(auditTrail);

      const safeAuthorMention = quote.sales_rep_id
        ? `<@${quote.sales_rep_id}>`
        : "Quote Author";

      if (decision === "REJECT") {
        quote.approval_status = "REJECTED";
        await client.apps.datastore.put({
          datastore: QuotesDatastore.name,
          item: quote,
        });

        const updatedCardP = buildLivingQuoteCard(
          client,
          quote_id,
          quote.name,
          0,
          quote.sales_rep_id,
          false,
        );
        const dmUpdateBlocks = [{
          type: "header",
          text: { type: "plain_text", text: "Quote #" + quote_id },
        }, {
          type: "section",
          text: {
            type: "mrkdwn",
            text: '**You rejected this quote.**\n*Audit Note:* "' + auditNote +
              '"',
          },
        }];
        const threadMsg =
          `[REJECTED] ${safeAuthorMention}: Your quote was rejected at Step ` +
          (curStep + 1) + ` of ` + gauntlet.length +
          ` by <@${body.user.id}>.\n> "${auditNote}"`;

        const updatedCard = await updatedCardP;

        const ops = [
          client.chat.update({
            channel: dm_channel_id,
            ts: dm_message_ts,
            text: "Quote #" + quote_id + " Rejected",
            blocks: dmUpdateBlocks,
          }),
          client.chat.postMessage({
            channel: targetChannelId,
            thread_ts: targetThreadTs,
            text: threadMsg,
          }),
          client.chat.update({
            channel: targetChannelId,
            ts: targetThreadTs,
            blocks: updatedCard,
            text: "Quote Rejected",
          }),
        ];

        if (quote.sales_rep_id) {
          ops.push(client.chat.postMessage({
            channel: quote.sales_rep_id,
            text: "Quote #" + quote_id + " Rejected by Deal Desk",
            blocks: [{
              type: "header",
              text: {
                type: "plain_text",
                text: "QUOTE REJECTED: #" + quote_id,
              },
            }, {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "<@" + body.user.id +
                  "> rejected your quote ledger. Check the primary broadcast channel thread for full instructions.",
              },
            }],
          }));
        }

        await Promise.all(ops);
      } else {
        const nextStep = curStep + 1;

        const dmUpdateBlocks = [{
          type: "header",
          text: { type: "plain_text", text: "Quote #" + quote_id },
        }, {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "**You approved Step " + (curStep + 1) + " of " +
              gauntlet.length + ".**",
          },
        }];
        const threadMsg = `[STEP APPROVED] ${safeAuthorMention}: Step ` +
          (curStep + 1) + ` of ` + gauntlet.length +
          ` successfully approved by <@${body.user.id}>.\n> "${auditNote}"`;

        if (nextStep >= gauntlet.length) {
          quote.approval_status = "APPROVED";
          quote.current_approval_step = nextStep;
          await client.apps.datastore.put({
            datastore: QuotesDatastore.name,
            item: quote,
          });

          const updatedCard = await buildLivingQuoteCard(
            client,
            quote_id,
            quote.name,
            0,
            quote.sales_rep_id,
            false,
          );

          await Promise.all([
            client.chat.update({
              channel: dm_channel_id,
              ts: dm_message_ts,
              text: "Quote #" + quote_id + " Approved",
              blocks: dmUpdateBlocks,
            }),
            client.chat.postMessage({
              channel: targetChannelId,
              thread_ts: targetThreadTs,
              text: threadMsg,
            }),
            client.chat.postMessage({
              channel: targetChannelId,
              thread_ts: targetThreadTs,
              text:
                `[APPROVED] ${safeAuthorMention}: *Total Consensus Reached!* This quote has cleared all mandated Deal Desk review parameters.`,
            }),
            client.chat.update({
              channel: targetChannelId,
              ts: targetThreadTs,
              blocks: updatedCard,
              text: "Quote Fully Approved",
            }),
          ]);
        } else {
          quote.current_approval_step = nextStep;
          await client.apps.datastore.put({
            datastore: QuotesDatastore.name,
            item: quote,
          });

          const updatedCard = await buildLivingQuoteCard(
            client,
            quote_id,
            quote.name,
            0,
            quote.sales_rep_id,
            false,
          );

          await Promise.all([
            client.chat.update({
              channel: dm_channel_id,
              ts: dm_message_ts,
              text: "Quote #" + quote_id + " Approved",
              blocks: dmUpdateBlocks,
            }),
            client.chat.postMessage({
              channel: targetChannelId,
              thread_ts: targetThreadTs,
              text: threadMsg,
            }),
            client.chat.update({
              channel: targetChannelId,
              ts: targetThreadTs,
              blocks: updatedCard,
              text: "Awaiting next tier",
            }),
            dispatchApprovalDM(
              client,
              quote_id,
              gauntlet[nextStep],
              targetThreadTs,
            ),
          ]);
        }
      }
      return { response_action: "clear" };
    },
  )
  .addBlockActionsHandler(
    ["catalog_select", "qty_val", "price_val"],
    async () => ({ completed: false }),
  );