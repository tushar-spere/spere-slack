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

// 🎯 STRICT BUILDER MATCH: Drops .00 on whole integers ($11), keeps cents ($11.50)
function formatBuilderPrice(n: number): string {
  const val = n || 0;
  if (val % 1 === 0) return val.toLocaleString("en-US");
  return val.toLocaleString("en-US", {
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

// 🎯 100% PIXEL-CLONED TYPESETTER
function drawMicroscopeBlocks(lineItemsJson: string): any[] {
  let items: any[] = [];
  try {
    items = JSON.parse(lineItemsJson || "[]");
  } catch (e) { /**/ }

  if (items.length === 0) {
    return [{
      type: "section",
      text: { type: "mrkdwn", text: "No itemized inventory attached." },
    }];
  }

  const resBlocks: any[] = [];
  let grandQty = 0;
  let grandTot = 0;

  items.forEach((item: any, idx: number) => {
    const q = parseInt(item.qty, 10) || 1;
    const p = parseFloat(item.unitPrice) || 0;
    const sub = q * p;
    grandQty += q;
    grandTot += sub;

    const pStr = formatBuilderPrice(p);
    const subStr = formatBuilderPrice(sub);

    // Line 1: Exact hyphen and spacing syntax
    let rowStr = `*${idx + 1}. ${item.productName || "Item"}* | Qty: ${
      q.toLocaleString("en-US")
    } (@ $${pStr}) - *$${subStr}*`;

    // Line 2: Exact L-arrow anchor, bolded labels, and pipe delimiters
    const specs: string[] = [];
    if (item.customSpecs && typeof item.customSpecs === "object") {
      for (const [k, v] of Object.entries(item.customSpecs)) {
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          specs.push(`*${k}:* ${v}`);
        }
      }
    }

    if (specs.length > 0) {
      rowStr += `\n↳ ${specs.join(" | ")}`;
    }

    resBlocks.push({
      type: "section",
      text: { type: "mrkdwn", text: rowStr },
    });
  });

  resBlocks.push(
    { type: "divider" },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Total Units:*\n${grandQty.toLocaleString("en-US")}`,
        },
        {
          type: "mrkdwn",
          text: `*Total Value:*\n*$${formatBuilderPrice(grandTot)}*`,
        },
      ],
    },
  );

  return resBlocks;
}

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
    });
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

async function buildTierTwoBoardroom(client: any, accountId: string) {
  const [accRes, quotesRes, accSchemaRes, allAccountsRes] = await Promise.all([
    client.apps.datastore.get({
      datastore: AccountsDatastore.name,
      id: accountId,
    }),
    client.apps.datastore.query({ datastore: QuotesDatastore.name }),
    client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "schema_account",
    }),
    client.apps.datastore.query({ datastore: AccountsDatastore.name }),
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

  const allAccounts = allAccountsRes.items || [];
  const switcherOptions = allAccounts.slice(0, 100).map((a: any) => ({
    text: { type: "plain_text", text: String(a.name).substring(0, 75) },
    value: String(a.id),
  }));
  const activeOption = switcherOptions.find((o: any) => o.value === accountId);

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: "*🔀 Switch Account*" },
      accessory: {
        type: "static_select",
        action_id: "select_account_action",
        placeholder: { type: "plain_text", text: "Jump to account..." },
        options: switcherOptions,
        ...(activeOption ? { initial_option: activeOption } : {}),
      },
    },
    { type: "divider" },
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
            formatBuilderPrice(totalPipeline)
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
      blocks.push({ type: "section", fields: fieldObjects.slice(i, i + 10) });
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
    });
  } else {
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

      blocks.push(
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
              text: `*Total Value:*\n$${formatBuilderPrice(qTot)}`,
            },
            {
              type: "mrkdwn",
              text: `*Create Date:*\n${formatEnterpriseDate(bornTs)}`,
            },
            {
              type: "mrkdwn",
              text: `*Last Modified:*\n${formatEnterpriseDate(modTs)}`,
            },
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

async function buildTierThreeMicroscope(client: any, quoteId: string) {
  const qRes = await client.apps.datastore.get({
    datastore: QuotesDatastore.name,
    id: quoteId,
  });
  const quote = qRes.item ||
    { name: "Unknown Deal", metadata: "{}", line_items: "[]" };

  let meta: Record<string, any> = {};
  try {
    meta = JSON.parse(quote.metadata || "{}");
  } catch (e) { /**/ }

  const bornTs = meta._sys_created_at || Math.floor(Date.now() / 1000);
  const modTs = meta._sys_updated_at || bornTs;
  const dealTot = calculateQuoteTotal(quote.line_items);
  const parentAccId = quote.description;

  const blocks: any[] = [];

  if (parentAccId) {
    blocks.push(
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "⬅️ Back", emoji: true },
            action_id: "pop_to_account_action",
            value: parentAccId,
          },
        ],
      },
      { type: "divider" },
    );
  }

  blocks.push(
    {
      type: "header",
      text: { type: "plain_text", text: `Quote Information: #${quoteId}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Name:*\n${quote.name}` },
        {
          type: "mrkdwn",
          text: `*Total Value:*\n*$${formatBuilderPrice(dealTot)}*`,
        },
        {
          type: "mrkdwn",
          text: `*Create Date:*\n${formatEnterpriseDate(bornTs)}`,
        },
        {
          type: "mrkdwn",
          text: `*Last Modified:*\n${formatEnterpriseDate(modTs)}`,
        },
      ],
    },
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "Bill of Materials" } },
    ...drawMicroscopeBlocks(quote.line_items),
  );

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
          }. *<@${t.approver_id}>* [${t.decision}]: "${t.note}"\n${
            formatEnterpriseDate(t.timestamp)
          }`,
        },
      });
    });
  }

  return {
    type: "modal",
    callback_id: "c360_tier_three",
    title: { type: "plain_text", text: `Quote #${quoteId}` },
    close: { type: "plain_text", text: "Close" },
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
      await client.views.update({
        view_id: body.view?.id,
        view: await buildTierThreeMicroscope(client, targetQuoteId),
      });
      return { completed: false };
    },
  )
  .addBlockActionsHandler(
    ["pop_to_account_action"],
    async ({ action, body, client }) => {
      const targetAccountId = action.value;
      if (!targetAccountId) return { completed: false };
      await client.views.update({
        view_id: body.view?.id,
        view: await buildTierTwoBoardroom(client, targetAccountId),
      });
      return { completed: false };
    },
  );
