import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";
import { feishuPlugin } from "./src/channel.js";
import { setFeishuRuntime } from "./src/runtime.js";
import { registerAllFeishuTools } from "./src/tools/index.js";

export { monitorFeishuProvider } from "./src/monitor.js";
export {
  sendMessageFeishu,
  sendCardFeishu,
  sendPostFeishu,
  updateCardFeishu,
  editMessageFeishu,
  getMessageFeishu,
} from "./src/api/send.js";
export {
  uploadImageFeishu,
  uploadFileFeishu,
  sendImageFeishu,
  sendFileFeishu,
  sendMediaFeishu,
} from "./src/api/media.js";
export { probeFeishu } from "./src/probe.js";
export {
  addReactionFeishu,
  removeReactionFeishu,
  listReactionsFeishu,
  FeishuEmoji,
} from "./src/api/reactions.js";
export { feishuPlugin } from "./src/channel.js";
export { createPoll, handleVoteCardAction, isVoteAction, getPoll, cleanupOldPolls } from "./src/features/vote/index.js";
export { handleUploadOnly } from "./src/features/big-video/bitable-video-handler.js";
export { analyzeVideoFromGcs } from "./src/features/video-analyze.js";

const plugin = {
  id: "joycastle-feishu",
  name: "joycastle-feishu",
  description: "Feishu/Lark channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    setFeishuRuntime(api.runtime);
    api.registerChannel({ plugin: feishuPlugin });
    registerAllFeishuTools(api);
  },
};

export default plugin;
