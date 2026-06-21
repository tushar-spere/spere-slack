import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { QuotesDatastore } from "../datastores/quotes.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const ListQuotesFunctionDefinition = DefineFunction({
  callback_id: "list_quotes_function",
  title: "List Quotes (Data Table)",
  description:
    "Fetches quotes and posts a rich data table directly to the channel",
  source_file: "functions/list_quotes.ts",
  input_parameters: {
    properties: { channel_id: { type: Schema.slack.types.channel_id } },
    required: ["channel_id"],
  },
  output_parameters: { properties: {}, required: [] },
});

export default SlackFunction(
  ListQuotesFunctionDefinition,
  async ({ inputs, client }) => {
    const { channel_id } = inputs;
    const settingsResponse = await client.apps.datastore.get({
      datastore: TenantSettingsDatastore.name,
      id: "schema_quote",
    });
    let tenantConfig: any[] = [];
    if (
      settingsResponse.ok && settingsResponse.item &&
      settingsResponse.item.custom_fields
    ) {
      tenantConfig = settingsResponse.item.custom_fields;
    }

    const queryResponse = await client.apps.datastore.query({
      datastore: QuotesDatastore.name,
    });
    if (!queryResponse.ok) {
      return { error: `Failed to fetch quotes: ${queryResponse.error}` };
    }
    const quotes = queryResponse.items;

    if (quotes.length === 0) {
      await client.chat.postMessage({
        channel: channel_id,
        text: "The quotes database is empty.",
      });
      return { outputs: {} };
    }

    const headerRow = [
      { type: "raw_text", text: "Quote ID" },
      { type: "raw_text", text: "Quote Name" },
      { type: "raw_text", text: "Attached Products" },
    ];

    tenantConfig.forEach((field) => {
      if (field.show_on_table === true) {
        const safeName = (field.name && String(field.name).trim() !== "")
          ? String(field.name)
          : "Custom Field";
        headerRow.push({ type: "raw_text", text: safeName });
      }
    });

    const tableRows = [headerRow];

    quotes.forEach((q) => {
      let productsString = "None";
      if (q.line_items) {
        try {
          const itemsArray = JSON.parse(q.line_items);
          if (itemsArray.length > 0) {
            productsString = itemsArray.map((i: any) =>
              `${i.productName} (x${i.qty})`
            ).join("\n");
          }
        } catch (e) {}
      }

      const row = [
        { type: "raw_text", text: String(q.id || "N/A") },
        { type: "raw_text", text: String(q.name || "N/A") },
        { type: "raw_text", text: productsString },
      ];

      let parsedMetadata: Record<string, any> = {};
      try {
        parsedMetadata = JSON.parse(q.metadata || "{}");
      } catch (e) {}

      tenantConfig.forEach((field, index) => {
        if (field.show_on_table === true) {
          const metadataKey = `custom_field_${index}`;
          row.push({
            type: "raw_text",
            text: parsedMetadata[metadataKey]
              ? String(parsedMetadata[metadataKey])
              : "-",
          });
        }
      });
      tableRows.push(row);
    });

    await client.chat.postMessage({
      channel: channel_id,
      text: "Sphere Quotes Database",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Sphere Quotes Database",
            emoji: true,
          },
        },
        { type: "data_table", caption: "Generated Quotes", rows: tableRows },
      ],
    });

    // By returning outputs here, the function cleanly shuts down!
    return { outputs: {} };
  },
);
