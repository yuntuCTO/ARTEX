"use client";

// Shared pieces of the LLM retry settings: "attempts + interval" for each of the five retry layers.
//
// The five layers, innermost to outermost: connect (SDK) → empty response (SDK) → same-provider safe window → pool breaker → intent rerun.
// The first three travel with the endpoint, so every model profile can override the global defaults; the last two are process-level and exist only once globally.
//
// All inputs follow the same "empty = unconfigured" semantics, matching the backend db.RetryRule:
//   attempts   empty/0 = built-in default | -1 = disable this layer's retries | >0 = use this count
//   interval   empty/0 = this layer's original exponential backoff | >0 = use this fixed interval in milliseconds

import * as React from "react";

import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { LLMRetryOverride, LLMRetryPolicy, LLMRetryRule } from "@/lib/types";

export const ZERO_RULE: LLMRetryRule = { attempts: 0, interval_ms: 0 };
export const ZERO_OVERRIDE: LLMRetryOverride = {
  connect: ZERO_RULE,
  empty: ZERO_RULE,
  stream: ZERO_RULE,
};
const ZERO_POLICY: LLMRetryPolicy = {
  ...ZERO_OVERRIDE,
  breaker: ZERO_RULE,
  intent: ZERO_RULE,
};

type LayerMeta = {
  title: string;
  /** Where this retry layer happens and who runs it */
  where: string;
  /** Which errors reach this layer — down to status codes, no guessing */
  trigger: string;
  /** Errors that look similar but do [not] go through this layer, so nobody thinks it is a bug after seeing no effect */
  skips?: string;
  desc: string;
  attemptsLabel: string;
  /** Default attempts when left empty, used for the placeholder */
  defAttempts: number;
  /** Default interval strategy when left empty, used for the placeholder */
  defInterval: string;
  /** Meaning of entering -1 for attempts */
  offHint: string;
};

export const RETRY_LAYERS = {
  connect: {
    title: "连接重试",
    where: "SDK · 收到 200 之前",
    trigger:
      "无法连接或尚未收到 200：连接重置 / 读写超时 / DNS 解析失败等网络层错误，以及 HTTP 408、429、500、502、503、504。",
    skips: "其余状态码（400 / 401 / 403 / 404 / 413 / 422 等）属于确定性拒绝——重发也会以同样方式失败，因此直接向上抛出。",
    desc: "原样重发同一请求。一旦流已开始（已收到 200），流中途断开便不再由本层处理。",
    attemptsLabel: "重试次数",
    defAttempts: 3,
    defInterval: "0.5s→1s→2s 指数退避（上限 8s）",
    offHint: "-1 = 完全不重试，失败立即向上抛出",
  },
  empty: {
    title: "空响应重试",
    where: "SDK · 仅 openai 格式",
    trigger:
      "HTTP 200 且 finish_reason 为正常的 stop，但响应中没有任何内容块——网关空帧、丢失 thinking 字段帧以及采样异常都会表现为这样。",
    skips: "因 max_tokens 截断导致的空响应不计入（应调高输出上限解决；重发只会再次触顶）。",
    desc: "会重发整个提示词，长上下文下开销较大，次数宜少。",
    attemptsLabel: "重试次数",
    defAttempts: 2,
    defInterval: "0.5s→1s→2s 指数退避（上限 8s）",
    offHint: "-1 = 将空响应原样透传",
  },
  stream: {
    title: "同供应商安全窗口重试",
    where: "本项目 · 尚未交付任何输出之前",
    trigger:
      "流建立后（已收到 200）才出现的问题：流中途断开、供应商过载、流内 429 / 5xx 错误事件——且此时尚未向调用方交付任何 token。",
    skips:
      "额度耗尽（402 / insufficient_quota，交由池切换配置）、上下文过长（413 / context length，交由压缩处理）以及确定性拒绝（400 / 401 / 403 / 404 / 422）均不会重试。",
    desc: "在同一配置上重放同一请求。由于尚未交付任何输出，重放不会造成模型输出或工具执行的重复。",
    attemptsLabel: "重试次数",
    defAttempts: 2,
    defInterval: "0.5s→1s 指数退避（上限 4s）",
    offHint: "-1 = 流中断后直接交给外层的意图重跑",
  },
  breaker: {
    title: "池熔断",
    where: "本项目 · 进程级，全局唯一",
    trigger:
      "瞬时失败（429、5xx、网络错误）连续累计达到阈值时熔断；确定性失败——余额不足（402）、Key 失效（401 / 403）、模型不存在（404）——无视阈值，首次出现即熔断。",
    skips: "一次成功即重置计数，因此偶尔不稳定的配置不会被慢慢累积到熔断。",
    desc: "熔断后进入冷却，冷却期间池会直接跳过该配置。状态会持久化，重启后依然保留。",
    attemptsLabel: "触发熔断的连续失败次数",
    defAttempts: 3,
    defInterval: "1min→5min→30min 梯度",
    offHint: "-1 = 瞬时失败永不熔断（确定性失败仍会熔断）",
  },
  intent: {
    title: "意图重跑",
    where: "本项目 · 进程级，全局唯一",
    trigger:
      "前几层都未能挽救：执行器以 model_error 结束——内层重试全部耗尽，或流在已开始交付输出后才断开（此时重放不安全，只能整体重跑）。",
    skips: "额度耗尽已由池切换配置处理，此处不会重跑；当任务处于暂停 / 中止 / 收尾状态时立即让出，不消耗退避时间。",
    desc: "从头重跑整个意图。它是最外层，因此每重跑一次都会让内层的尝试次数再翻一倍。",
    attemptsLabel: "重跑次数",
    defAttempts: 2,
    defInterval: "固定 3s",
    offHint: "-1 = 不重跑，意图直接标记为阻塞",
  },
} satisfies Record<string, LayerMeta>;

type LayerKey = keyof typeof RETRY_LAYERS;

/** Milliseconds in human terms, only echoed next to the input so nobody counts zeros. */
function humanMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(2))}s`;
  return `${Number((ms / 60_000).toFixed(2))}min`;
}

/** Controlled numeric input: empty string ↔ 0; intermediate states ("-", "1e") stay local and never bother the parent. */
function NumField({
  id,
  value,
  onChange,
  placeholder,
  min,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  placeholder: string;
  min: number;
}) {
  const [text, setText] = React.useState(value === 0 ? "" : String(value));
  // Keeps up when the parent swaps in a whole new set of values (policy loaded, profile switched); typing never reaches this,
  // because by then value already equals the parsed result of the local text.
  React.useEffect(() => {
    const incoming = value === 0 ? "" : String(value);
    setText((cur) => (Number(cur || 0) === value ? cur : incoming));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      className="w-28 shrink-0"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === "" || !Number.isFinite(n) ? 0 : Math.trunc(n));
      }}
    />
  );
}

/** The two knobs of one retry layer. idPrefix keeps the label's htmlFor unique when it appears multiple times on one page. */
export function RetryRuleFields({
  layer,
  idPrefix,
  value,
  onChange,
  compact,
}: {
  layer: LayerKey;
  idPrefix: string;
  value: LLMRetryRule;
  onChange: (r: LLMRetryRule) => void;
  /** true = compact version inside the profile drawer: skips the expanded explanations, keeping only the "which errors reach this layer" line */
  compact?: boolean;
}) {
  const meta = RETRY_LAYERS[layer];
  const human = humanMs(value.interval_ms);
  return (
    <div className={compact ? "grid gap-2" : "grid gap-3 rounded-lg border p-3"}>
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <Label className="text-sm">{meta.title}</Label>
          <span className="text-muted-foreground text-xs">{meta.where}</span>
        </div>
        {/* Which errors reach this layer, down to status codes — if the knobs seem to have no effect, the error most likely does not land on this layer at all. */}
        <p className="text-muted-foreground text-xs">
          <span className="font-medium text-foreground">触发条件</span>: {meta.trigger}
        </p>
        {!compact && meta.skips && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium text-foreground">此层跳过</span>: {meta.skips}
          </p>
        )}
        {!compact && <p className="text-muted-foreground text-xs">{meta.desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-n`} className="text-muted-foreground text-xs">
            {meta.attemptsLabel}
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-n`}
            min={-1}
            value={value.attempts}
            placeholder={`默认 ${meta.defAttempts}`}
            onChange={(n) => onChange({ ...value, attempts: n })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-ms`} className="text-muted-foreground text-xs">
            间隔 ms
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-ms`}
            min={0}
            value={value.interval_ms}
            placeholder="默认退避"
            onChange={(n) => onChange({ ...value, interval_ms: n })}
          />
          <span className="text-muted-foreground text-xs">{human ? `固定 ${human}` : meta.defInterval}</span>
        </div>
      </div>
      {!compact && <p className="text-muted-foreground text-xs">留空 = 使用默认值；{meta.offHint}。</p>}
    </div>
  );
}

/** The three-layer override in the model profile drawer (the three layers that travel with the endpoint). */
export function ProfileRetryFields({
  value,
  onChange,
}: {
  value: LLMRetryOverride;
  onChange: (o: LLMRetryOverride) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <Label className="text-sm">重试覆盖</Label>
        <p className="text-muted-foreground text-xs">
          仅对此配置生效，覆盖「重试与退避」中的全局默认值。字段留空 = 跟随全局；次数为 -1 = 禁用该层；填写间隔则以固定间隔替代指数退避。熔断与意图重跑为进程级，只能在全局页面调整。
        </p>
      </div>
      {(["connect", "empty", "stream"] as const).map((k) => (
        <div key={k} className="border-t pt-3 first:border-t-0 first:pt-0">
          <RetryRuleFields
            compact
            layer={k}
            idPrefix="pf"
            value={value[k]}
            onChange={(r) => onChange({ ...value, [k]: r })}
          />
        </div>
      ))}
    </div>
  );
}

/** The "Retry & backoff" tab: global defaults for the five layers. */
export function RetryPolicyPanel() {
  const [policy, setPolicy] = React.useState<LLMRetryPolicy>(ZERO_POLICY);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.llmRetryPolicy();
      setPolicy({ ...ZERO_POLICY, ...p });
    } catch (e) {
      toast.error(`加载重试策略失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // The backend clamps out-of-range values back into the interval and returns them; refresh straight from the reply so what you see is what is stored.
      const saved = await api.saveLLMRetryPolicy(policy);
      setPolicy({ ...ZERO_POLICY, ...saved });
      toast.success("已保存，立即生效（正在进行中的调用仍使用旧参数）");
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: LayerKey) => (r: LLMRetryRule) => setPolicy((p) => ({ ...p, [k]: r }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-10 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> 正在加载重试策略…
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs leading-relaxed">
        模型调用失败后会依次经过五层重试，由内到外依次为：
        <span className="text-foreground"> 连接 → 空响应 → 同供应商安全窗口 → 池熔断 → 意图重跑</span>
        。外层只处理内层耗尽后的失败，因此各层尝试次数会
        <span className="text-foreground">相乘</span>
        ——每层都调到最大，一次小故障就可能消耗数十个请求。
        全部留空则保持当前默认值，与本页面出现之前的行为一致。前三层可按模型配置单独覆盖。
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(RETRY_LAYERS) as LayerKey[]).map((k) => (
          <RetryRuleFields key={k} layer={k} idPrefix="gl" value={policy[k]} onChange={set(k)} />
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          保存
        </Button>
        <Button variant="outline" onClick={() => setPolicy(ZERO_POLICY)} disabled={saving}>
          全部重置为默认值
        </Button>
      </div>
    </div>
  );
}
