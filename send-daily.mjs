import * as Lark from "@larksuiteoapi/node-sdk";

const client = new Lark.Client({
  appId: "cli_a9f05db654f8dbc6",
  appSecret: "AZt40GUGEhd1MlPHqjN37dBk4jqaDjVy",
  appType: Lark.AppType.SelfBuild,
  domain: Lark.Domain.Feishu,
});

const chatId = "oc_df60177a3d84ff0fbe40d9071c4f0fbf";

const postContent = {
  zh_cn: {
    title: "📮 Unity 技术日报 | 2026-01-30",
    content: [
      [{ tag: "text", text: "🔧 技术资源\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "① R3 — 新一代 Reactive Extensions for Unity\n" }],
      [{ tag: "text", text: "Cysharp 出品，UniRx 正统续作。移除 IScheduler，性能大幅提升；原生支持帧驱动操作，零 GC 订阅管理。适合替换老项目中的 UniRx，事件驱动逻辑更顺滑。\n" }],
      [{ tag: "text", text: "🔗 " }, { tag: "a", text: "GitHub - Cysharp/R3", href: "https://github.com/Cysharp/R3" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "② ParticleEffectForUGUI — UGUI 中直接渲染粒子特效\n" }],
      [{ tag: "text", text: "不需要额外 Camera / RenderTexture / Canvas，直接通过 CanvasRenderer 渲染粒子。支持 Mask、RectMask2D 裁剪和排序，做 UI 粒子特效（抽卡、按钮光效）必备。\n" }],
      [{ tag: "text", text: "🔗 " }, { tag: "a", text: "GitHub - ParticleEffectForUGUI", href: "https://github.com/mob-sakai/ParticleEffectForUGUI" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "━━━━━━━━━━━━━━━━\n" }],
      [{ tag: "text", text: "📚 知识小课堂\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "① Addressables 引用计数机制\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "每次 LoadAssetAsync → 计数 +1\n" }],
      [{ tag: "text", text: "每次 Release → 计数 -1\n" }],
      [{ tag: "text", text: "归零时才真正卸载资源\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "⚠️ 常见坑：加载 N 次只 Release 1 次 → 内存泄漏\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "✅ 正确写法：\n" }],
      [{ tag: "code_block", language: "csharp", text: "var handle = Addressables.LoadAssetAsync<GameObject>(\"Prefabs/Enemy\");\nhandle.Completed += op => Instantiate(op.Result);\n\n// 用完必须成对释放\nAddressables.Release(handle);" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "💡 实战建议：封装 AssetLoader 管理类，用 Dictionary 记录 handle 和引用次数，OnDestroy 中统一释放。\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "━━━━━━━━━━━━━━━━\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "② Job System + Burst 编译器\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "Job System → 计算密集逻辑丢到工作线程\n" }],
      [{ tag: "text", text: "Burst → 把 C# 编译成优化的原生机器码\n" }],
      [{ tag: "text", text: "两者配合，性能提升 10~50 倍\n" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "✅ 示例：批量计算距离\n" }],
      [{ tag: "code_block", language: "csharp", text: "[BurstCompile]\nstruct DistanceJob : IJobParallelFor\n{\n    [ReadOnly] public NativeArray<float3> positions;\n    public NativeArray<float> distances;\n    public float3 target;\n\n    public void Execute(int index)\n    {\n        distances[index] = math.distance(positions[index], target);\n    }\n}\n\n// 调度执行\nvar job = new DistanceJob\n{\n    positions = posArray,\n    distances = distArray,\n    target = playerPos\n};\nvar handle = job.Schedule(posArray.Length, 64);\nhandle.Complete();" }],
      [{ tag: "text", text: "\n" }],
      [{ tag: "text", text: "⚠️ 注意：\n" }],
      [{ tag: "text", text: "· Job 内只能用值类型 + NativeContainer，不能用 string / class\n" }],
      [{ tag: "text", text: "· Burst 不支持 try-catch 和虚方法调用" }],
    ],
  },
};

const response = await client.im.message.create({
  params: { receive_id_type: "chat_id" },
  data: {
    receive_id: chatId,
    content: JSON.stringify(postContent),
    msg_type: "post",
  },
});

console.log("code:", response.code, "msg:", response.msg);
console.log("message_id:", response.data?.message_id);
