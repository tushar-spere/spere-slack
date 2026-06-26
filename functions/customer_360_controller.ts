import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { AccountsDatastore } from "../datastores/accounts.ts";
import { QuotesDatastore } from "../datastores/quotes.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const Customer360ControllerDefinition = DefineFunction({
  callback_id: "customer_360_controller",
  title: "Customer 360 Command Center",
  description: "Executive 3-Tier Dossier and Microscope Interrogation Engine",
  source_file: "functions/customer_360_controller.ts",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

function calculateItemSubtotal(item: any): number {
  const q = parseInt(item.qty, 10) || 1;
  const p = parseFloat(item.unitPrice) || 0;
  return q * p;
}

function calculateQuoteTotal(lineItemsJson: string): number {
  try {
    const items = JSON.parse(lineItemsJson || "[]");
    return items.reduce(
      (acc: number, item: any) => acc + calculateItemSubtotal(item),
      0,
    );
  } catch (e) {
    return 0;
  }
}

function formatEnterpriseCurrency(n: number): string {
  return (n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatEnterpriseDate(unixTs: number): string {
  if (!unixTs) return "-";
  const d = new Date(unixTs * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getQuoteStatusBadge(q: any): string {
  if (q.approval_status === "APPROVED") return "Approved";
  if (q.approval_status === "REJECTED") return "Rejected";
  if (q.approval_status === "PENDING_GAUNTLET") {
    let gauntlet: string[] = [];
    try {
      gauntlet = JSON.parse(q.approval_gauntlet || "[]");
    } catch (e) { /**/ }

    const stepNum = (q.current_approval_step || 0) + 1;
    const totalSteps = gauntlet.length;
    const currentApproverId = gauntlet[q.current_approval_step || 0];

    if (currentApproverId) {
      return `Awaiting Step ${stepNum} of ${totalSteps} (<@${currentApproverId}>)`;
    }
    return `Awaiting Step ${stepNum} of ${totalSteps}`;
  }
  return "Pending Review";
}

function drawMicroscopeTable(lineItemsJson: string, prodSchema: any[]) {
  const tick3 = String.fromCharCode(96, 96, 96);
  let items: any[] = [];
  try {
    items = JSON.parse(lineItemsJson || "[]");
  } catch (e) { /**/ }

  if (items.length === 0) {
    return tick3 + "\nNo itemized inventory attached.\n" + tick3;
  }

  const headers = (prodSchema || []).filter((f: any) =>
    f.show_on_table !== false
  ).map((f: any) => String(f.name || "Spec").toUpperCase());
  const wProd = 16, wQty = 5, wPrice = 10, wCustom = 12, wSub = 11;
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
      String(q).padStart(wQty) +
      ("$" + formatEnterpriseCurrency(p)).padStart(wPrice);
    headers.forEach((h: string) => {
      const mKey = Object.keys(i.customSpecs || {}).find((k) =>
        k.toUpperCase() === h
      );
      const val = mKey ? i.customSpecs[mKey] : "-";
      rStr +=
        ("  " +
          (val !== undefined && val !== null && val !== "" ? String(val) : "-")
            .substring(0, wCustom - 2)).padEnd(wCustom);
    });
    str += rStr + ("$" + formatEnterpriseCurrency(sub)).padStart(wSub) + "\n";
  });

  str += divider + String("TOTALS").padEnd(wProd) +
    String(sQty).padStart(wQty) + "".padEnd(wPrice);
  headers.forEach(() => str += "".padEnd(wCustom));
  return str + ("$" + formatEnterpriseCurrency(sTot)).padStart(wSub) + "\n" +
    tick3;
}

// TIER 1: THE LOBBY
async function buildTierOneLobby(client: any) {
  const accRes = await client.apps.datastore.query({
    datastore: AccountsDatastore.name,
  });
  const accounts = accRes.items || [];

  const blocks: any[] = [];

  if (accounts.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No accounts exist in the database." },
    }); // 🎯 Stripped italics
  } else {
    const opts = accounts.slice(0, 100).map((a: any) => ({
      text: { type: "plain_text", text: String(a.name).substring(0, 75) },
      value: String(a.id),
    }));
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Select Account*" },
      accessory: {
        type: "static_select",
        action_id: "select_account_action",
        placeholder: { type: "plain_text", text: "Search accounts..." },
        options: opts,
      },
    });
  }

  return {
    type: "modal",
    callback_id: "c360_tier_one",
    title: { type: "plain_text", text: "Customer 360" },
    close: { type: "plain_text", text: "Close" },
    blocks,
  };
}

// TIER 2: THE BOARDROOM DOSSIER
async function buildTierTwoBoardroom(client: any, accountId: string) {
  const [accRes, quotesRes, accSchemaRes] = await Promise.all([
    client.apps.datastore.get({
      datastore: AccountsDatastore.name,
      id: accountId,
    }),
    client.apps.datastore.query({ datastore: QuotesDatastore.name }),
    client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "schema_account",
    }),
  ]);

  const account = accRes.item || { name: "Unknown Account", metadata: "{}" };
  let meta: Record<string, any> = {};
  try {
    meta = JSON.parse(account.metadata || "{}");
  } catch (e) { /**/ }

  const clientQuotes = (quotesRes.items || []).filter((q: any) =>
    q.description === accountId
  );
  const totalPipeline = clientQuotes.reduce(
    (sum: number, q: any) => sum + calculateQuoteTotal(q.line_items),
    0,
  );

  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: String(account.name).substring(0, 150),
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Account ID:*\n${accountId}` },
        {
          type: "mrkdwn",
          text: `*Lifetime Quoted Volume:*\n$${
            formatEnterpriseCurrency(totalPipeline)
          } across ${clientQuotes.length} record(s)`,
        },
      ],
    },
  ];

  const customFields = accSchemaRes.item?.custom_fields || [];
  const cKeys = Object.keys(meta).filter((k) => k.startsWith("custom_field_"));

  if (cKeys.length > 0) {
    const fieldObjects: any[] = [];
    cKeys.forEach((k) => {
      const idx = parseInt(k.replace("custom_field_", ""), 10);
      const val = meta[k];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        fieldObjects.push({
          type: "mrkdwn",
          text: `*${customFields[idx]?.name || "Field"}:*\n${val}`,
        });
      }
    });

    for (let i = 0; i < fieldObjects.length; i += 10) {
      blocks.push({
        type: "section",
        fields: fieldObjects.slice(i, i + 10),
      });
    }
  }

  blocks.push({ type: "divider" }, {
    type: "header",
    text: { type: "plain_text", text: "📄 Related Quotes" },
  });

  if (clientQuotes.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No quotes attached to this account." },
    }); // 🎯 Stripped italics
  } else {
    // 🎯 SERIAL INDEX INJECTED INTO LOOP
    clientQuotes.forEach((q: any, idx: number) => {
      const qTot = calculateQuoteTotal(q.line_items);
      const cleanStatus = getQuoteStatusBadge(q);
      const serialNumber = idx + 1;

      let bornTs = Math.floor(Date.now() / 1000);
      let modTs = bornTs;

      try {
        const pMeta = JSON.parse(q.metadata || "{}");
        if (pMeta._sys_created_at) bornTs = pMeta._sys_created_at;
        if (pMeta._sys_updated_at) modTs = pMeta._sys_updated_at;
        else modTs = bornTs;
      } catch (e) { /**/ }

      const createdStr = formatEnterpriseDate(bornTs);
      const modifiedStr = formatEnterpriseDate(modTs);

      blocks.push(
        // 🎯 UPRIGHT PLAIN TEXT ID + BOLD SERIAL ANCHOR
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${serialNumber}. ${q.name}*\n#${q.id}`,
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "View Details" },
            action_id: "push_microscope_action",
            value: q.id,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Status:*\n${cleanStatus}` },
            {
              type: "mrkdwn",
              text: `*Total Value:*\n$${formatEnterpriseCurrency(qTot)}`,
            },
            { type: "mrkdwn", text: `*Create Date:*\n${createdStr}` },
            { type: "mrkdwn", text: `*Last Modified:*\n${modifiedStr}` },
          ],
        },
        { type: "divider" },
      );
    });
  }

  return {
    type: "modal",
    callback_id: "c360_tier_two",
    title: { type: "plain_text", text: "Customer 360" },
    close: { type: "plain_text", text: "Done" },
    blocks,
  };
}

// TIER 3: THE MICROSCOPE
async function buildTierThreeMicroscope(client: any, quoteId: string) {
  const [qRes, qSchemaRes, pSchemaRes] = await Promise.all([
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

  const quote = qRes.item ||
    { name: "Unknown Deal", metadata: "{}", line_items: "[]" };
  let meta: Record<string, any> = {};
  try {
    meta = JSON.parse(quote.metadata || "{}");
  } catch (e) { /**/ }

  const bornTs = meta._sys_created_at || Math.floor(Date.now() / 1000);
  const modTs = meta._sys_updated_at || bornTs;
  const dealTot = calculateQuoteTotal(quote.line_items);

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Quote Readout: #${quoteId}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Record Title:*\n${quote.name}` },
        {
          type: "mrkdwn",
          text: `*Valuation:*\n*$${formatEnterpriseCurrency(dealTot)}*`,
        },
        {
          type: "mrkdwn",
          text: `*Create Date:*\n<!date^${bornTs}^{date_num}|Date>`,
        },
        {
          type: "mrkdwn",
          text: `*Last Modified:*\n<!date^${modTs}^{date_num}|Date>`,
        },
      ],
    },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: "*Bill of Materials:*" } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: drawMicroscopeTable(
          quote.line_items,
          pSchemaRes.item?.custom_fields,
        ),
      },
    },
  ];

  let trail: any[] = [];
  try {
    trail = JSON.parse(quote.approval_audit_trail || "[]");
  } catch (e) { /**/ }

  if (trail.length > 0) {
    blocks.push({ type: "divider" }, {
      type: "header",
      text: { type: "plain_text", text: "Audit Log" },
    });
    trail.forEach((t: any, i: number) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${
            i + 1
          }. *<@${t.approver_id}>* [${t.decision}]: "${t.note}" \n<!date^${t.timestamp}^{date_short_pretty} at {time}|Date>`,
        },
      }); // 🎯 Stripped italics
    });
  }

  return {
    type: "modal",
    callback_id: "c360_tier_three",
    title: { type: "plain_text", text: `Quote #${quoteId}` },
    blocks,
  };
}

export default SlackFunction(
  Customer360ControllerDefinition,
  async ({ inputs, client }) => {
    await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: await buildTierOneLobby(client),
    });
    return { completed: false };
  },
)
  .addBlockActionsHandler(
    ["select_account_action"],
    async ({ action, body, client }) => {
      const pickedAccountId = (action as any).selected_option.value;
      await client.views.update({
        view_id: body.view?.id,
        view: await buildTierTwoBoardroom(client, pickedAccountId),
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["push_microscope_action"],
    async ({ action, body, client }) => {
      const targetQuoteId = action.value;
      await client.views.push({
        interactivity_pointer: body.interactivity.interactivity_pointer,
        view: await buildTierThreeMicroscope(client, targetQuoteId),
      });
      return { completed: false };
    },
  );
