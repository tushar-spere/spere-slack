import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const QuotesDatastore = DefineDatastore({
  name: "quotes",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    name: { type: Schema.types.string },
    description: { type: Schema.types.string },
    metadata: { type: Schema.types.string },
    line_items: { type: Schema.types.string },
  },
});
