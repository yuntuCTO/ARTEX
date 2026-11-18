// Channel field table and config-value parsing helpers.
//
// This lives apart from the page because it is **data**, not a view: it describes which fields each channel has,
// which control each field uses, and the two-way conversion between form text and config values (JSON).
// In its own file, adding a channel only touches this file — the page itself needs no changes.
// Display names and blurbs for channel types. Kept in the frontend because they only affect copy; the backend does not need to know.
export const KIND_LABEL: Record<string, string> = {
  dingtalk: "DingTalk",
  feishu: "Feishu",
  wecom: "WeCom",
  webhook: "通用 Webhook",
  telegram: "Telegram",
  email: "电子邮件",
};

// Config field definitions per channel.
//
// A frontend field table is kept here deliberately instead of having the backend send down a schema: the backend only does
// Validate (required/format), while the UI needs layout and control types — not the same concern.
// The single coupling point is secret_keys — which fields render as password inputs comes from the backend,
// because only the channel implementation knows which values are credentials (WeCom's entire Webhook is the credential,
// whereas DingTalk's is just one secret). A missing entry here for a new channel only blanks the form;
// it does not fail silently (hasFields below surfaces it).
export type FieldKind = "text" | "password" | "number" | "select" | "textarea" | "switch" | "kv" | "list";
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}
export const CHANNEL_FIELDS: Record<string, FieldDef[]> = {
  dingtalk: [
    {
      key: "webhook",
      label: "Webhook URL",
      kind: "text",
      placeholder: "https://oapi.dingtalk.com/robot/send?access_token=...",
    },
    {
      key: "secret",
      label: "签名密钥",
      kind: "password",
      help: "机器人安全设置使用“加签”时填写；使用“自定义关键词”或未启用安全设置时留空",
    },
  ],
  feishu: [
    {
      key: "webhook",
      label: "Webhook URL",
      kind: "text",
      placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
    },
    { key: "secret", label: "签名校验密钥", kind: "password", help: "机器人启用“签名校验”时填写；否则留空" },
  ],
  wecom: [
    {
      key: "webhook",
      label: "Webhook URL",
      kind: "text",
      placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
    },
  ],
  webhook: [
    { key: "url", label: "目标 URL", kind: "text", placeholder: "https://your-endpoint.example.com/hook" },
    {
      key: "method",
      label: "HTTP 方法",
      kind: "select",
      options: [
        { value: "POST", label: "POST（带请求体）" },
        { value: "PUT", label: "PUT（带请求体）" },
        { value: "PATCH", label: "PATCH（带请求体）" },
        { value: "GET", label: "GET（无请求体）" },
      ],
    },
    { key: "headers", label: "自定义请求头", kind: "kv", help: "每行一个 KEY=VALUE，例如 Authorization=Bearer xxx" },
    {
      key: "body_template",
      label: "请求体模板",
      kind: "textarea",
      help:
        "留空使用内置默认模板。变量： {{.Title}} {{.Batch}} {{.Count}} {{.HomeURL}} {{.SentAt}}, " +
        "以及 range .Items 下的 .Name/.VulnClass/.Severity/.Summary/.Assets/.DetailURL/.StatusLabel。 " +
        "插入字符串时请使用 {{json .Xxx}} 而非 {{.Xxx}}，否则标题中的引号会破坏 JSON。",
    },
  ],
  telegram: [
    { key: "bot_token", label: "Bot Token", kind: "password", placeholder: "123456:ABC-DEF..." },
    { key: "chat_id", label: "Chat ID", kind: "text", placeholder: "-1001234567890" },
    {
      key: "base_url",
      label: "API URL",
      kind: "text",
      placeholder: "https://api.telegram.org",
      help: "留空使用官方 URL；代理自托管 Bot API 时填写",
    },
  ],
  email: [
    { key: "host", label: "SMTP 服务器", kind: "text", placeholder: "smtp.example.com" },
    {
      key: "port",
      label: "端口",
      kind: "number",
      placeholder: "587",
      help: "587 使用 STARTTLS；465 请开启“隐式 TLS”",
    },
    { key: "username", label: "账户", kind: "text" },
    { key: "password", label: "密码 / 授权码", kind: "password" },
    { key: "from", label: "发件人", kind: "text", placeholder: "artex@example.com" },
    { key: "to", label: "收件人", kind: "list", help: "多个地址用逗号分隔" },
    { key: "tls", label: "隐式 TLS", kind: "switch", help: "465 端口开启；587 端口保持关闭（自动使用 STARTTLS）" },
  ],
};

export const SEVERITY_OPTIONS = [
  { value: "", label: "全部严重程度" },
  { value: "low", label: "低危及以上" },
  { value: "medium", label: "中危及以上" },
  { value: "high", label: "高危及以上" },
  { value: "critical", label: "仅严重" },
];

export type ChannelForm = {
  name: string;
  kind: string;
  mode: "realtime" | "digest";
  enabled: boolean;
  ratePerMin: string;
  config: Record<string, unknown>;
  minSeverity: string;
  includeText: string;
  excludeText: string;
  taskIDsText: string;
  assetIDsText: string;
  onStatusChange: boolean;
};

export const emptyForm = (kind: string): ChannelForm => ({
  name: "",
  kind,
  mode: "realtime",
  enabled: true,
  ratePerMin: "",
  config: {},
  minSeverity: "",
  includeText: "",
  excludeText: "",
  taskIDsText: "",
  assetIDsText: "",
  onStatusChange: false,
});

// parseKV parses a "KEY=VALUE per line" textarea.
export function parseKV(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
// parseIDs parses a comma/whitespace-separated id list.
export function parseIDs(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}
// parseKeywords parses a line/comma-separated keyword list (vulnerability type names may contain spaces, hence splitting on lines or commas).
export function parseKeywords(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
