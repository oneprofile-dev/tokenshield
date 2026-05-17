import type { Conversation, ConvBlock } from "../providers/types.js";
import type { Processor, ProcessorContext, ProcessorResult } from "./types.js";

/**
 * Conversation deduplication.
 *
 * Walks the conversation in message order. The first occurrence of any
 * tool_result content (keyed by its content hash) is kept verbatim. Subsequent
 * occurrences are replaced with a compact pointer that references the prior one.
 *
 * Determinism: same input always produces the same output (hash-based ordering),
 * so Anthropic prompt caching remains valid.
 *
 * Fail-open: if any block can't be handled cleanly, it's left untouched.
 */
class ConversationDedup implements Processor {
  readonly id = "conversation-dedup";
  readonly enabledByDefault = true;

  /** Only elide payloads worth eliding — avoids stub-overhead on tiny results. */
  static readonly MIN_ELIDE_BYTES = 256;

  onRequest(conv: Conversation, _ctx: ProcessorContext): ProcessorResult {
    const seen = new Map<string, { messageIndex: number; toolUseId: string }>();
    let elidedBytesTotal = 0;
    let elidedCount = 0;
    let mutated = false;

    const newMessages = conv.messages.map((msg, msgIdx) => {
      const newBlocks = msg.blocks.map<ConvBlock>((block) => {
        if (block.kind !== "tool_result") return block;
        if (block.pointer) return block; // already deduped (idempotency)
        const prior = seen.get(block.contentHash);
        if (prior === undefined) {
          seen.set(block.contentHash, {
            messageIndex: msgIdx,
            toolUseId: block.tool_use_id,
          });
          return block;
        }
        if (block.contentBytes < ConversationDedup.MIN_ELIDE_BYTES) {
          // Not worth the stub overhead; leave verbatim.
          return block;
        }
        mutated = true;
        elidedBytesTotal += block.contentBytes;
        elidedCount++;
        return {
          ...block,
          pointer: {
            priorMessageIndex: prior.messageIndex,
            priorToolUseId: prior.toolUseId,
            elidedBytes: block.contentBytes,
          },
        };
      });
      return mutated ? { ...msg, blocks: newBlocks } : msg;
    });

    if (!mutated) {
      return { conversation: conv, effects: [] };
    }

    return {
      conversation: { ...conv, messages: newMessages },
      effects: [
        {
          name: this.id,
          bytesSaved: elidedBytesTotal,
          detail: { elidedCount, distinctContent: seen.size },
        },
      ],
    };
  }
}

export const conversationDedup = new ConversationDedup();
