import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { QuotesDatastore } from "../datastores/quotes.ts";
import { TenantSettingsDatastore } from "../datastores/tenant_settings.ts";

export const ViewQuoteDetailsFunctionDefinition = DefineFunction({
  callback_id: "view_quote_details_function",
  title: "View Quote Details",
  description: "Interactive modal to search and view quotes",
  source_file: "functions/view_quote_details.ts",
  input_parameters: {
    properties: { interactivity: { type: Schema.slack.types.interactivity } },
    required: ["interactivity"],
  },
  output_parameters: { properties: {}, required: [] },
});

// Draws the Modal!
async function buildViewerModal(client: any, selectedQuoteId: string | null) {
  const queryResponse = await client.apps.datastore.query({
    datastore: QuotesDatastore.name,
  });
  const quotes = queryResponse.ok ? queryResponse.items : [];

  const quoteOptions = quotes.slice(0, 100).map((q: any) => ({
    text: { type: "plain_text", text: `${q.id} - ${q.name}`.substring(0, 75) },
    value: String(q.id),
  }));

  if (quoteOptions.length === 0) {
    quoteOptions.push({
      text: { type: "plain_text", text: "No quotes available" },
      value: "none",
    });
  }

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: "🔍 *Search for a Quote*" },
      accessory: {
        type: "static_select",
        action_id: "select_quote_to_view",
        placeholder: { type: "plain_text", text: "Select a Quote..." },
        options: quoteOptions,
      },
    },
    { type: "divider" },
  ];

  if (selectedQuoteId && selectedQuoteId !== "none") {
    const quote = quotes.find((q: any) => q.id === selectedQuoteId);
    if (quote) {
      const settingsRes = await client.apps.datastore.get({
        datastore: TenantSettingsDatastore.name,
        id: "schema_quote",
      });
      const customFields = (settingsRes.ok && settingsRes.item?.custom_fields)
        ? settingsRes.item.custom_fields
        : [];

      blocks.push({
        type: "header",
        text: { type: "plain_text", text: `📄 Quote: ${quote.id}` },
      });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Quote Name:* ${quote.name || "N/A"}` },
      });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "*📋 Custom Fields*" },
      });

      let parsedMetadata: Record<string, any> = {};
      try {
        parsedMetadata = JSON.parse(quote.metadata || "{}");
      } catch (e) {}

      let hasCustomFields = false;
      customFields.forEach((field: any, index: number) => {
        const val = parsedMetadata[`custom_field_${index}`];
        if (val) {
          hasCustomFields = true;
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `*${field.name}:*\n${val}` },
          });
        }
      });

      if (!hasCustomFields) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: "_No custom fields recorded._" }],
        });
      }

      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "*📦 Attached Products*" },
      });

      let lineItems: any[] = [];
      try {
        lineItems = JSON.parse(quote.line_items || "[]");
      } catch (e) {}

      if (lineItems.length === 0) {
        blocks.push({
          type: "context",
          elements: [{
            type: "mrkdwn",
            text: "_No products attached to this quote._",
          }],
        });
      } else {
        lineItems.forEach((item: any) => {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `▪️ *${item.productName}*\n_Quantity:_ ${item.qty}`,
            },
          });
        });
      }
    }
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_Select a quote from the dropdown above to view its details._",
      },
    });
  }

  return {
    type: "modal",
    callback_id: "view_quote_details_modal",
    title: { type: "plain_text", text: "Quote Viewer" },
    close: { type: "plain_text", text: "Close" },
    blocks: blocks,
  };
}

export default SlackFunction(
  ViewQuoteDetailsFunctionDefinition,
  async ({ inputs, client }) => {
    // 1. Open the initial blank Search modal
    const initialView = await buildViewerModal(client, null);
    await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: initialView,
    });
    // This tells the function to STAY AWAKE to listen for clicks!
    return { completed: false };
  },
)
  // 2. Intercept the dropdown click to paint the data onto the screen
  .addBlockActionsHandler(
    ["select_quote_to_view"],
    async ({ action, body, client }) => {
      const selectedQuoteId = action.selected_option.value;
      const viewId = body.view?.id;

      if (viewId) {
        const updatedView = await buildViewerModal(client, selectedQuoteId);
        await client.views.update({ view_id: viewId, view: updatedView });
      }
      return { completed: false };
    },
  )
  // 3. Cleanly shut down the server when the user hits "Close"
  .addViewClosedHandler(["view_quote_details_modal"], () => {
    return { completed: true };
  });
