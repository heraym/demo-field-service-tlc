// functions.js
import logger from "./logger.js";

import { sendJsonSafe } from "./gemini-connection.js";

/**
 * This tool immediately responds back to Gemini with:
 *   { rendered: true, state: "continue conversation" }
 * so the model continues the conversation without pausing.
 * Then it sends the text to the client for display.
 */
export async function handleWriteText(fc, clientWs, geminiConn, clientId) {
  try {
    const { id, name, args } = fc; // e.g. { id: "function-call-123", name: "write_text", args: { text: "foo" } }

    // 1) Immediately respond so Gemini knows to continue
    await geminiConn._sendJson({
      tool_response: {
        function_responses: [
          {
            id,
            name,
            response: {
              rendered: true,
              state: "continue conversation",
            },
          },
        ],
      },
    });

    // 2) Then do your actual "write_text" logic
    const textToWrite = args?.text || "";
    logger.info(
      `[write_text] Writing text to client ${clientId}: "${textToWrite}"`
    );
     
    
    // Send a special message back to the client so it can show the text in the UI
    await sendJsonSafe(clientWs, {
      type: "tool_text",
      data: textToWrite,
    });
  } catch (err) {
    logger.error(`[write_text] Error for client=${clientId}:`, err);
  }
}

export async function handleEndCall(fc, clientWs, geminiConn, clientId) {
  try {
    const { id, name, args } = fc;

    // 1) Immediately respond so Gemini knows to continue
    await geminiConn._sendJson({
      tool_response: {
        function_responses: [
          {
            id,
            name,
            response: {
              rendered: true,
              state: "continue conversation",
            },
          },
        ],
      },
    });

    // 2) Send a special message back to the client to end the call
    await sendJsonSafe(clientWs, {
      type: "end_call",
      data: args?.reason || "Call ended by AI",
    });

    logger.info(
      `[end_call] Ending call for client ${clientId}: "${
        args?.reason || "No reason provided"
      }"`
    );
  } catch (err) {
    logger.error(`[end_call] Error for client=${clientId}:`, err);
  }
}

// Add more handler functions here, for other tools...
// e.g. export async function handleSearch(...) { ... }

export const toolHandlers = {
  write_text: handleWriteText,
  end_call: handleEndCall,
  // moreHandlersHere: handleXYZ,
};
