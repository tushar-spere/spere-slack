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
    sales_rep_id: { type: Schema.slack.types.user_id },

    // ADVANCED APPROVAL STATE MACHINE EXPANSION:
    approval_gauntlet: { type: Schema.types.string }, // Array of User IDs, e.g. '["U1", "U2"]'
    current_approval_step: { type: Schema.types.number }, // Active execution index pointer
    approval_status: { type: Schema.types.string }, // "PENDING_GAUNTLET", "APPROVED", "REJECTED"
    approval_audit_trail: { type: Schema.types.string }, // Array of historical notes & timestamps

    // THE THREAD TRACKING UPGRADE:
    broadcast_channel_id: { type: Schema.types.string }, // Stores the exact channel where the master card lives
    broadcast_thread_ts: { type: Schema.types.string }, // Stores the parent timestamp identifier for threading replies
  },
});
