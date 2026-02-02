import lark from "@larksuiteoapi/node-sdk";

const APP_ID = "cli_a9f05db654f8dbc6";
const APP_SECRET = "AZt40GUGEhd1MlPHqjN37dBk4jqaDjVy";

const client = new lark.Client({ appId: APP_ID, appSecret: APP_SECRET });

const pollId = `poll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const card = {
  config: { wide_screen_mode: true, update_multi: true },
  header: {
    title: { tag: "plain_text", content: "📊 今天下午茶喝什么？" },
    template: "blue",
  },
  elements: [
    {
      tag: "markdown",
      content: "📊 可多选，点击按钮投票（再次点击取消）",
    },
    { tag: "hr" },
    ...["美式咖啡", "抹茶拿铁", "柠檬茶", "奶茶"].flatMap((opt, i) => [
      {
        tag: "markdown",
        content: `**${opt}**\n${"░".repeat(16)}  0票 (0%)`,
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: `投 "${opt}"` },
            type: "default",
            value: { action: "vote_toggle", pollId, optionIndex: i },
          },
        ],
      },
    ]),
    { tag: "hr" },
    {
      tag: "note",
      elements: [{ tag: "plain_text", content: "共 0 人参与投票" }],
    },
    {
      tag: "action",
      actions: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "🔒 结束投票" },
          type: "danger",
          value: { action: "vote_close", pollId },
        },
      ],
    },
  ],
};

const resp = await client.im.message.create({
  params: { receive_id_type: "open_id" },
  data: {
    receive_id: "ou_841797e6c6009a30dddb49dd7276bb6c",
    content: JSON.stringify(card),
    msg_type: "interactive",
  },
});

console.log("Response:", JSON.stringify(resp, null, 2));

if (resp.code === 0) {
  const messageId = resp.data?.message_id;
  console.log(`\nSuccess! messageId: ${messageId}, pollId: ${pollId}`);

  // Save vote data file so the callback handler can find it
  const fs = await import("fs");
  const path = await import("path");
  const voteDir = path.join(process.env.HOME, ".clawdbot", "vote-data");
  fs.mkdirSync(voteDir, { recursive: true });
  const voteData = {
    pollId,
    question: "今天下午茶喝什么？",
    options: ["美式咖啡", "抹茶拿铁", "柠檬茶", "奶茶"],
    voters: {},
    multiSelect: true,
    anonymous: false,
    closed: false,
    creatorOpenId: "ou_841797e6c6009a30dddb49dd7276bb6c",
    messageId,
    chatId: "ou_841797e6c6009a30dddb49dd7276bb6c",
    createdAt: Date.now(),
  };
  fs.writeFileSync(
    path.join(voteDir, `${pollId}.json`),
    JSON.stringify(voteData, null, 2)
  );
  console.log(`Vote data saved to ${voteDir}/${pollId}.json`);
}
