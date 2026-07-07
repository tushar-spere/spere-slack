import { QuotesDatastore } from "../datastores/quotes.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";
import { AccountsDatastore } from "../datastores/accounts.ts";
import { buildLivingQuoteCard, formatInCardTable } from "./post_quote_card.ts";

// ==========================================
// 1. RULE EVALUATION ENGINE & HELPERS
// ==========================================

export async function getAccountDisplayName(
  client: any,
  accId?: string,
): Promise<string> {
  if (!accId || accId === "NO_ACCOUNT" || accId === "undefined") {
    return "Unassigned Account";
  }
  try {
    const accRes = await client.apps.datastore.get({
      datastore: AccountsDatastore.name,
      id: accId,
    });
    return accRes.item?.name ? String(accRes.item.name) : accId;
  } catch (_e) {
    return accId;
  }
}

export function testOperator(
  actualVal: any,
  operator: string,
  targetVal: string,
): boolean {
  if (actualVal === undefined || actualVal === null) return false;
  const aStr = String(actualVal).trim(), tStr = String(targetVal).trim();
  const aNum = parseFloat(actualVal) || 0, tNum = parseFloat(targetVal) || 0;
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

export function evaluateCondition(
  cond: any,
  quoteObj: any,
  lineItemsArr: any[],
  metaBlob: Record<string, any>,
  prodSchema: any[],
): boolean {
  const { field_ref, operator, target_val } = cond;
  if (field_ref === "quote.total_amount") {
    let calc = 0;
    lineItemsArr.forEach((i: any) =>
      calc += (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0)
    );
    return testOperator(calc, operator, target_val);
  }
  if (field_ref === "quote.customer_name") {
    return testOperator(quoteObj.description, operator, target_val) ||
      testOperator(quoteObj.name, operator, target_val);
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

// ==========================================
// 2. EXECUTIVE DM BUILDERS
// ==========================================

export async function buildApprovalDMBlocks(
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

  const accountDisplay = await getAccountDisplayName(client, quote.description);

  let calcTot = 0;
  itemsArr.forEach((i: any) =>
    calcTot += (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0)
  );

  const safeAuthorDisplay = quote.sales_rep_id
    ? `<@${quote.sales_rep_id}>`
    : "Author unrecorded";

  const nowTs = Math.floor(Date.now() / 1000);
  const createdTs = metaBlob._sys_created_at || nowTs;
  const updatedTs = metaBlob._sys_updated_at || createdTs;

  let statusText = "Mandated Executive Review";
  if (quote.approval_status === "PENDING_GAUNTLET") {
    const gauntlet = quote.approval_gauntlet
      ? JSON.parse(quote.approval_gauntlet)
      : [];
    statusText = "Awaiting Step " + ((quote.current_approval_step || 0) + 1) +
      " of " + gauntlet.length + " (<@" +
      gauntlet[quote.current_approval_step || 0] + ">)";
  }

  const coreGrid = [
    { type: "mrkdwn", text: "*Account:*\n" + accountDisplay },
    { type: "mrkdwn", text: "*Total Value:*\n$" + calcTot.toLocaleString() },
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
        text: "*Itemized Inventory Breakdown (" + itemsArr.length + ")*\n" +
          formatInCardTable(itemsArr, pSchemaRes.item?.custom_fields),
      },
    });
  }

  const humanDecisionsOnly = auditTrail.filter((entry: any) =>
    entry.decision === "APPROVE" || entry.decision === "REJECT"
  );
  if (humanDecisionsOnly.length > 0) {
    blocks.push({ type: "divider" }, {
      type: "section",
      text: { type: "mrkdwn", text: "*Prior Audit Trail:*" },
    });
    humanDecisionsOnly.forEach((entry: any, idx: number) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${idx + 1}. *<@${entry.approver_id}>:* "${entry.note}"`,
        },
      });
    });
  }

  const gauntlet = quote.approval_gauntlet
    ? JSON.parse(quote.approval_gauntlet)
    : [];
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
        text: "*Execution Relay:* You are Step " +
          ((quote.current_approval_step || 0) + 1) + " of " + gauntlet.length +
          " in the mandated deal desk sign-off chain.",
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

export async function buildResolvedApprovalDMBlocks(
  client: any,
  quoteId: string,
  decision: string,
  auditNote: string,
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
  if (!quote) {
    return [{
      type: "section",
      text: { type: "mrkdwn", text: `**${decision}**` },
    }];
  }

  const metaBlob = quote.metadata ? JSON.parse(quote.metadata) : {};
  const itemsArr = quote.line_items ? JSON.parse(quote.line_items) : [];
  const accountDisplay = await getAccountDisplayName(client, quote.description);

  let calcTot = 0;
  itemsArr.forEach((i: any) =>
    calcTot += (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0)
  );

  const safeAuthorDisplay = quote.sales_rep_id
    ? `<@${quote.sales_rep_id}>`
    : "Author unrecorded";
  const nowTs = Math.floor(Date.now() / 1000);
  const createdTs = metaBlob._sys_created_at || nowTs;
  const updatedTs = metaBlob._sys_updated_at || createdTs;

  const isApprove = decision === "APPROVE";
  const badgeText = isApprove
    ? "✅ *YOU APPROVED THIS QUOTE*"
    : "❌ *YOU DECLINED THIS QUOTE*";
  const headerPrefix = isApprove ? "[APPROVED]" : "[DECLINED]";

  const coreGrid = [
    { type: "mrkdwn", text: "*Account:*\n" + accountDisplay },
    { type: "mrkdwn", text: "*Total Value:*\n$" + calcTot.toLocaleString() },
    {
      type: "mrkdwn",
      text: "*Status:*\n" + (isApprove ? "Approved by You" : "Declined by You"),
    },
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
        text: `${headerPrefix} #${quoteId} - ${quote.name}`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${badgeText}\n> *Your Audit Note:* ${auditNote}`,
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

  if (itemsArr.length > 0) {
    blocks.push({ type: "divider" }, {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Itemized Inventory Breakdown (" + itemsArr.length + ")*\n" +
          formatInCardTable(itemsArr, pSchemaRes.item?.custom_fields),
      },
    });
  }

  return blocks;
}

// ==========================================
// 3. NETWORK DISPATCH & DECISION PROCESSOR
// ==========================================

export async function dispatchFreshApprovalDM(
  client: any,
  quoteObj: any,
  targetApproverId: string,
  threadTs: string,
) {
  const blocks = await buildApprovalDMBlocks(
    client,
    quoteObj.id,
    threadTs,
    false,
  );
  if (!blocks) return null;

  const postRes = await client.chat.postMessage({
    channel: targetApproverId,
    blocks,
    text: "Approval requested for #" + quoteObj.id,
  });
  if (postRes.ok) {
    quoteObj.active_dm_channel = postRes.channel;
    quoteObj.active_dm_ts = postRes.ts;
    await client.apps.datastore.put({
      datastore: QuotesDatastore.name,
      item: quoteObj,
    });
  }
  return postRes;
}

export async function processApprovalSubmission({ view, body, client }: any) {
  const meta = JSON.parse(view.private_metadata),
    auditNote = view.state.values.audit_note_block.note_input.value ||
      "No note provided.";
  const quoteRes = await client.apps.datastore.get({
    datastore: QuotesDatastore.name,
    id: meta.quote_id,
  });
  const quote = quoteRes.item;
  if (!quote) return { response_action: "clear" };

  const gauntlet: string[] = quote.approval_gauntlet
      ? JSON.parse(quote.approval_gauntlet)
      : [],
    curStep = quote.current_approval_step || 0;
  const auditTrail: any[] = quote.approval_audit_trail
    ? JSON.parse(quote.approval_audit_trail)
    : [];

  auditTrail.push({
    approver_id: body.user.id,
    decision: meta.decision,
    note: auditNote,
    timestamp: Math.floor(Date.now() / 1000),
  });
  quote.approval_audit_trail = JSON.stringify(auditTrail);

  const targetChan = quote.broadcast_channel_id ?? meta.dm_channel_id,
    targetTs = meta.thread_ts ?? quote.broadcast_thread_ts;

  const accountDisplay = await getAccountDisplayName(client, quote.description);

  const resolvedDmBlocks = await buildResolvedApprovalDMBlocks(
    client,
    meta.quote_id,
    meta.decision,
    auditNote,
  );

  if (meta.decision === "REJECT") {
    quote.approval_status = "REJECTED";
    quote.active_dm_channel = "";
    quote.active_dm_ts = "";
    await client.apps.datastore.put({
      datastore: QuotesDatastore.name,
      item: quote,
    });
    const card = await buildLivingQuoteCard(
      client,
      meta.quote_id,
      quote.name,
      0,
      quote.sales_rep_id,
      false,
    );
    await Promise.all([
      client.chat.update({
        channel: meta.dm_channel_id,
        ts: meta.dm_message_ts,
        text: "Declined Quote #" + meta.quote_id,
        blocks: resolvedDmBlocks,
      }),
      client.chat.postMessage({
        channel: targetChan,
        thread_ts: targetTs,
        text:
          `<@${body.user.id}> declined Quote #${meta.quote_id} • ${accountDisplay}\n> *${auditNote}*`,
      }),
      client.chat.update({
        channel: targetChan,
        ts: targetTs,
        blocks: card,
        text: "Declined",
      }),
    ]);
  } else {
    const nextStep = curStep + 1;
    if (nextStep >= gauntlet.length) {
      quote.approval_status = "APPROVED";
      quote.current_approval_step = nextStep;
      quote.active_dm_channel = "";
      quote.active_dm_ts = "";
      await client.apps.datastore.put({
        datastore: QuotesDatastore.name,
        item: quote,
      });
      const card = await buildLivingQuoteCard(
        client,
        meta.quote_id,
        quote.name,
        0,
        quote.sales_rep_id,
        false,
      );
      await Promise.all([
        client.chat.update({
          channel: meta.dm_channel_id,
          ts: meta.dm_message_ts,
          text: "Approved Quote #" + meta.quote_id,
          blocks: resolvedDmBlocks,
        }),
        // 🎯 Flavor A (Middle Dot): Final Approval (Total Consensus - Comma Removed)
        client.chat.postMessage({
          channel: targetChan,
          thread_ts: targetTs,
          text:
            `<@${body.user.id}> approved Quote #${meta.quote_id} • ${accountDisplay} (Step ${gauntlet.length} of ${gauntlet.length})\n> *${auditNote}*\n\n✅ <@${quote.sales_rep_id}> You can now share this with the client.`,
        }),
        client.chat.update({
          channel: targetChan,
          ts: targetTs,
          blocks: card,
          text: "Fully Approved",
        }),
      ]);
    } else {
      quote.current_approval_step = nextStep;
      await client.apps.datastore.put({
        datastore: QuotesDatastore.name,
        item: quote,
      });
      const card = await buildLivingQuoteCard(
        client,
        meta.quote_id,
        quote.name,
        0,
        quote.sales_rep_id,
        false,
      );
      await Promise.all([
        client.chat.update({
          channel: meta.dm_channel_id,
          ts: meta.dm_message_ts,
          text: "Approved Quote #" + meta.quote_id,
          blocks: resolvedDmBlocks,
        }),
        client.chat.update({
          channel: targetChan,
          ts: targetTs,
          blocks: card,
          text: "Tier 2",
        }),
        // 🎯 Flavor A (Middle Dot): Intermediate Approval (Comma Removed & Context Added)
        client.chat.postMessage({
          channel: targetChan,
          thread_ts: targetTs,
          text:
            `<@${body.user.id}> approved Quote #${meta.quote_id} • ${accountDisplay} (Step ${
              curStep + 1
            } of ${gauntlet.length})\n> *${auditNote}*\n\n👉 <@${
              gauntlet[nextStep]
            }> Quote is ready for your review (Step ${
              nextStep + 1
            } of ${gauntlet.length}).`,
        }),
        dispatchFreshApprovalDM(
          client,
          quote,
          gauntlet[nextStep],
          targetTs,
        ),
      ]);
    }
  }
  return { response_action: "clear" };
}
