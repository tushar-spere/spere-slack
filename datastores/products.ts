import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

/**
 * Products Datastore
 * Stores the catalog of available products.
 */
export const ProductsDatastore = DefineDatastore({
  name: "products",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    name: { type: Schema.types.string },
    description: { type: Schema.types.string },
  },
});
