import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

/**
 * Quotes Datastore
 * Stores the transaction records of generated quotes.
 */
export const QuotesDatastore = DefineDatastore({
  name: "quotes",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    product_id: { type: Schema.types.string },
    quantity: { type: Schema.types.integer },
    unit_price: { type: Schema.types.number },
    total_price: { type: Schema.types.number },
    created_by: { type: Schema.slack.types.user_id },
  },
});
