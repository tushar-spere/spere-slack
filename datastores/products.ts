import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const ProductsDatastore = DefineDatastore({
  // THE VERSION BUMP: We point the system to a clean V2 table
  name: "products_v2",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    name: { type: Schema.types.string },
    description: { type: Schema.types.string },
    // V2 is safely provisioned to accept raw strings
    metadata: { type: Schema.types.string },

    // 🎯 V2 FINANCIAL & LIFECYCLE EXPANSION:
    price: { type: Schema.types.number }, // Standard commercial list price ($)
    is_active: { type: Schema.types.boolean }, // Soft-delete availability toggle
  },
});