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
    approval_gauntlet: { type: Schema.types.string },
    current_approval_step: { type: Schema.types.number },
    approval_status: { type: Schema.types.string },
    approval_audit_trail: { type: Schema.types.string },

    // THE THREAD TRACKING UPGRADE:
    broadcast_channel_id: { type: Schema.types.string },
    broadcast_thread_ts: { type: Schema.types.string },
    card_instances: {
      type: Schema.types.string,
      description: "JSON array of { channel_id: string, ts: string, is_primary: boolean }",
    },

    // =========================================================================
    // 🎯 THE TRACKING COLLAR: Explicitly whitelisted to survive disk I/O
    // =========================================================================
    active_dm_channel: { type: Schema.types.string },
    active_dm_ts: { type: Schema.types.string },
  },
});