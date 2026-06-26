import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const AccountsDatastore = DefineDatastore({
  name: "accounts",
  primary_key: "id",
  attributes: {
    id: { type: Schema.types.string },
    name: { type: Schema.types.string },
    metadata: { type: Schema.types.string }, // The dynamic custom fields
  },
});