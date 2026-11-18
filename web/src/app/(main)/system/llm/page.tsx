"use client";

import * as React from "react";

import {
  Loader2Icon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  StarIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { LLMPoolMember, LLMPoolStatus, LLMProfile, LLMRetryOverride } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ProfileRetryFields, RetryPolicyPanel, ZERO_OVERRIDE } from "./_components/retry";
import { setVisibleInterval } from "@/lib/polling";

// The thinking switch (thinking.type) and the thinking effort (reasoning_effort) are two [independent] fields,
// each set on its own — some APIs have no thinking field and activate thinking via the effort parameter alone, hence the decoupling.
// An empty string in storage = the field is [not sent]; Radix Select rejects an empty value, so the UI uses "none"
// as the sentinel for not sent, converted to and from "" on load and save (NONE / fromStore / toStore).
const NONE = "none";
const fromStore = (v?: string) => (v ? v : NONE);
const toStore = (v: string) => (v === NONE ? "" : v);
const THINKING_TYPES: { value: string; label: string }[] = [
  { value: NONE, label: "不发送（默认）" },
  { value: "disabled", label: "已禁用" },
  { value: "enabled", label: "已启用" },
];
// Which request field name carries the output cap (only meaningful for the openai format). NONE ↔ "" shares the same sentinel conversion.
const MAX_TOKENS_FIELDS: { value: string; label: string }[] = [
  { value: NONE, label: "max_tokens（默认）" },
  { value: "max_completion_tokens", label: "max_completion_tokens" },
];
// The other formats hard-code their field names, so the option is meaningless for them; the hint texts spell this out.
const MAX_TOKENS_FIELD_HINTS: Record<string, string> = {
  openai:
    "上限通过哪个字段传递。max_tokens 为默认值，绝大多数兼容网关只接受它；而 OpenAI 官方推理模型（o 系列 / GPT-5）反而只接受 max_completion_tokens，收到 max_tokens 会直接报 unsupported_parameter 错误。",
  anthropic: "仅 openai 格式可选。Anthropic 的字段名固定为 max_tokens。",
  "openai-responses": "仅 openai 格式可选。Responses API 的字段名固定为 max_output_tokens。",
  ollama: "仅 openai 格式可选。Ollama 的字段名固定为 max_tokens。",
};
// LLM profile formats. The default in the create form is "anthropic"; "ollama" is the
// keyless local-server format (base URL defaults to http://127.0.0.1:11434/v1).
type ProfileFormat = "anthropic" | "openai" | "openai-responses" | "ollama";
const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const EFFORT_LEVELS: { value: string; label: string }[] = [
  { value: NONE, label: "不发送（默认）" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

function cooldownText(secs: number) {
  if (secs <= 0) return "";
  if (secs < 60) return `${secs}s`;
  return `${Math.ceil(secs / 60)}min`;
}

// The "healthy or not" badge a profile shows on its card. A profile without a Key cannot send any request at all — say that before the breaker;
// the exception is Ollama, a keyless local server that IS callable without a key. The other states come from the pool's breaker
// records (with polling off no new records appear, so "healthy" = no known failure).
type Health = { label: string; cls: string; hint?: string };
function healthOf(p: LLMProfile, m?: LLMPoolMember): Health {
  if (!p.api_key_hint && p.format !== "ollama") {
    return {
      label: "未配置 Key",
      cls: "border-muted-foreground/40 text-muted-foreground",
      hint: "未设置 API Key，无法调用",
    };
  }
  if (m?.state === "tripped") {
    return {
      label: m.cooldown_secs > 0 ? `已熔断 · ${cooldownText(m.cooldown_secs)}` : "已熔断",
      cls: "border-destructive/50 text-destructive",
      hint: m.last_error,
    };
  }
  if (m?.state === "degraded") {
    return {
      label: `已降级 · 失败 ${m.fails} 次`,
      cls: "border-amber-500/50 text-amber-600 dark:text-amber-400",
      hint: m.last_error,
    };
  }
  return { label: "健康", cls: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 池设置 drawer
// ─────────────────────────────────────────────────────────────────────────────

function PoolSheet({
  open,
  onOpenChange,
  pool,
  onReload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pool: LLMPoolStatus | null;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);

  // The cooldown countdown is the remaining seconds computed by the backend — fetched on a timer only while the drawer is open and some profile is unhealthy, to keep it ticking.
  React.useEffect(() => {
    if (!open || !pool?.enabled || !pool.chain.some((m) => m.state !== "ok")) return;
    const stopPolling = setVisibleInterval(() => void onReload(), 10_000);
    return stopPolling;
  }, [open, pool, onReload]);

  async function toggle(patch: { llm_pool_enabled?: boolean; llm_pool_bind_fallback?: boolean }) {
    if (busy) return;
    setBusy(true);
    try {
      await api.setSettings(patch);
      await onReload();
      if (patch.llm_pool_enabled !== undefined) {
        toast.success(patch.llm_pool_enabled ? "LLM 池已启用" : "LLM 池已禁用");
      } else {
        toast.success("兜底设置已更新");
      }
    } catch (e) {
      toast.error(`应用设置失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function recover(id?: string) {
    try {
      await api.resetLLMPool(id);
      await onReload();
      toast.success(id ? "配置已恢复" : "所有配置已恢复");
    } catch (e) {
      toast.error(`恢复失败：${(e as Error).message}`);
    }
  }

  const enabled = pool?.enabled ?? false;
  const chain = pool?.chain ?? [];
  // Members taking part in the pool (excluding those flagged "excluded from pool"), in the exact order the backend tries them.
  const inChain = chain.filter((m) => m.active || !m.excluded);
  const tripped = chain.filter((m) => m.state === "tripped");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="px-4">
          <SheetTitle className="flex items-center gap-2">
            <ZapIcon className="size-4" /> LLM 池 · 故障转移
          </SheetTitle>
          <SheetDescription>
            启用后，<b>未固定模型</b>的智能体在当前配置不可用（余额不足 / Key 失效 / 限流 /
            服务错误）时会自动切换到下一个配置。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label className="text-sm">启用池</Label>
              <p className="text-muted-foreground text-xs">默认关闭。关闭时始终只使用当前启用的配置，失败即失败。</p>
            </div>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggle({ llm_pool_enabled: v })}
              aria-label="LLM 池开关"
            />
          </div>

          {enabled && (
            <>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label className="text-sm">固定配置失败时也兜底</Label>
                  <p className="text-muted-foreground text-xs">
                    默认关闭：智能体或任务固定了某个配置时，只使用该配置，失败即失败（不会静默切换到其他模型）。启用后，固定配置失败时也会兜底到下方的池链路。
                  </p>
                </div>
                <Switch
                  checked={pool?.bind_fallback ?? false}
                  disabled={busy}
                  onCheckedChange={(v) => void toggle({ llm_pool_bind_fallback: v })}
                  aria-label="固定配置失败兜底开关"
                />
              </div>

              <Separator />

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">池顺序</Label>
                  {tripped.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => void recover()}>
                      <RotateCcwIcon /> 全部恢复
                    </Button>
                  )}
                </div>
                {inChain.length < 2 && (
                  <p className="text-muted-foreground text-xs">
                    当前仅有 {inChain.length} 个可用配置，池不会生效——至少需要 2 个参与池的可用配置（已设置 API Key，或为 Ollama）
                    。
                  </p>
                )}
                {chain.map((m) => {
                  const excluded = m.excluded && !m.active;
                  const order = excluded ? null : inChain.findIndex((x) => x.profile_id === m.profile_id) + 1;
                  return (
                    <div
                      key={m.profile_id}
                      className={cn(
                        "grid gap-1 rounded-lg border p-2.5 text-sm",
                        excluded && "opacity-55",
                        m.state === "tripped" && "border-destructive/40",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="w-5 shrink-0 text-center font-mono text-muted-foreground text-xs">
                          {order ?? "—"}
                        </span>
                        <span className="font-medium">{m.name}</span>
                        {m.active && (
                          <Badge variant="outline" className="border-amber-400/50 text-amber-500">
                            当前启用
                          </Badge>
                        )}
                        {excluded && <Badge variant="outline">不参与池</Badge>}
                        <div className="ml-auto flex items-center gap-2">
                          {m.state === "tripped" && m.cooldown_secs > 0 && (
                            <span className="text-muted-foreground text-xs">冷却中 {cooldownText(m.cooldown_secs)}</span>
                          )}
                          {m.state === "degraded" && (
                            <span className="text-muted-foreground text-xs">连续失败 {m.fails} 次</span>
                          )}
                          {m.state !== "ok" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label="立即恢复"
                              title="立即恢复：清除熔断，下次调用将重试此配置"
                              onClick={() => void recover(m.profile_id)}
                            >
                              <RotateCcwIcon className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 pl-7 text-muted-foreground text-xs">
                        <code className="truncate font-mono">{m.model}</code>
                        {!m.active && <span>优先级 {m.priority}</span>}
                      </div>
                      {m.last_error && (
                        <p className="truncate pl-7 font-mono text-muted-foreground text-xs" title={m.last_error}>
                          {m.last_error}
                        </p>
                      )}
                    </div>
                  );
                })}
                {chain.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm">
                    暂无配置
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-xs leading-relaxed">
                当前启用的配置始终排在首位，其余按优先级从高到低排列（在各配置中设置）。配置失败后进入冷却（60s → 5min → 30min），冷却期间被跳过，恢复后自动切回。上下文窗口容纳不下当前请求的配置会被跳过。固定了模型的智能体和任务默认不加入池。
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model profile drawer (create / edit share the same form)
// ─────────────────────────────────────────────────────────────────────────────

function ProfileSheet({
  profile,
  open,
  onOpenChange,
  onSaved,
}: {
  profile: LLMProfile | null; // null = create
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const isNew = !profile;
  const [name, setName] = React.useState("");
  const [format, setFormat] = React.useState<ProfileFormat>("anthropic");
  const [model, setModel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [proxy, setProxy] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [keyHint, setKeyHint] = React.useState("");
  const [rps, setRps] = React.useState("0");
  const [rpm, setRpm] = React.useState("0");
  const [cw, setCw] = React.useState("0"); // context window (K tokens); 0 = default 200K
  const [thinkingType, setThinkingType] = React.useState(NONE);
  const [effort, setEffort] = React.useState(NONE);
  const [priority, setPriority] = React.useState("0"); // pool order; higher = tried earlier
  const [poolExclude, setPoolExclude] = React.useState(false);
  const [streaming, setStreaming] = React.useState(true); // true = streaming (default); false = non-streaming
  const [maxTokens, setMaxTokens] = React.useState("0"); // per-reply output cap; 0 = not sent
  const [maxTokensField, setMaxTokensField] = React.useState(NONE); // which field name carries the cap; NONE = max_tokens
  const [sessionHeaderKey, setSessionHeaderKey] = React.useState(""); // custom session header name; empty = not sent
  const [userAgent, setUserAgent] = React.useState(""); // custom User-Agent; empty = keep the default UA
  const [retry, setRetry] = React.useState<LLMRetryOverride>(ZERO_OVERRIDE); // retry override for this profile; all 0 = follow the global
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [models, setModels] = React.useState<string[]>([]);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const [modelQuery, setModelQuery] = React.useState(""); // filter text for the loaded model list; reset on open/close

  // Every time it opens, the form is re-filled from the passed-in profile (reset to defaults when creating). Closing and reopening
  // the drawer is a clean start, leaving no leftovers from the previous profile.
  React.useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setFormat(
      profile?.format === "openai" || profile?.format === "openai-responses" || profile?.format === "ollama"
        ? profile.format
        : "anthropic",
    );
    setModel(profile?.model ?? "");
    setBaseUrl(profile?.base_url ?? "");
    setProxy(profile?.proxy ?? "");
    setRps(String(profile?.rate_per_second ?? 0));
    setRpm(String(profile?.rate_per_minute ?? 0));
    setCw(String(profile?.context_window_k ?? 0));
    setThinkingType(fromStore(profile?.thinking_type));
    setEffort(fromStore(profile?.reasoning_effort));
    setPriority(String(profile?.priority ?? 0));
    setPoolExclude(profile?.pool_exclude ?? false);
    setStreaming(profile?.streaming ?? true);
    setMaxTokens(String(profile?.max_tokens ?? 0));
    setMaxTokensField(fromStore(profile?.max_tokens_field));
    setSessionHeaderKey(profile?.session_header_key ?? "");
    setUserAgent(profile?.user_agent ?? "");
    setRetry(profile?.retry ?? ZERO_OVERRIDE);
    setApiKey("");
    setKeyHint(profile?.api_key_hint ?? "");
    setModels([]);
    setModelsOpen(false);
    setModelQuery("");
  }, [open, profile]);

  const profileId = profile ? Number(profile.id) : undefined;

  // Case-insensitive substring filter, so a provider prefix ("deepseek/") or a
  // fragment ("flash") is enough to narrow a 400-entry list.
  const filteredModels = React.useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, modelQuery]);

  async function loadModels() {
    if (loadingModels) return;
    setLoadingModels(true);
    setModels([]);
    setModelQuery("");
    try {
      const r = await api.fetchLLMModels(format, baseUrl, apiKey, proxy, profileId);
      if (r.ok && r.models && r.models.length > 0) {
        setModels(r.models);
        setModelsOpen(true);
        toast.success(`已加载 ${r.models.length} 个模型`);
      } else {
        toast.error(`加载模型失败：${r.error ?? "未返回任何模型"}`);
      }
    } catch (e) {
      toast.error(`加载模型出错：${(e as Error).message}`);
    } finally {
      setLoadingModels(false);
    }
  }

  async function testConnection() {
    if (testing) return;
    setTesting(true);
    try {
      // Test with the thinking parameters the profile would actually run, so a model that does not support the field fails here,
      // not when a task is already running. Pass the profile id: with the Key input left empty, the stored Key is used.
      const r = await api.testLLM(
        format,
        model,
        baseUrl,
        apiKey,
        proxy,
        toStore(thinkingType),
        toStore(effort),
        profileId,
        streaming,
        sessionHeaderKey.trim(),
        userAgent.trim(),
      );
      // Show the reply too: only when the model demonstrably spoke is this the same as working inside a session.
      if (r.ok)
        toast.success(`连接成功 · ${r.latency_ms ?? "?"}ms · ${r.model ?? model}`, {
          description: r.reply ? `回复：${r.reply}` : undefined,
        });
      else toast.error(`连接失败：${r.error ?? "未知错误"}`);
    } catch (e) {
      toast.error(`测试出错：${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!name.trim() || !model.trim()) {
      toast.error("请填写名称和模型");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const { id } = await api.saveLLMProfile({
        ...(profile ? { id: Number(profile.id) } : {}),
        name: name.trim(),
        format,
        model: model.trim(),
        base_url: baseUrl.trim(),
        proxy: proxy.trim(),
        api_key: apiKey,
        rate_per_second: Number(rps) || 0,
        rate_per_minute: Number(rpm) || 0,
        context_window_k: Number(cw) || 0,
        thinking_type: toStore(thinkingType),
        reasoning_effort: toStore(effort),
        priority: Number(priority) || 0,
        pool_exclude: poolExclude,
        streaming,
        max_tokens: Math.max(0, Number(maxTokens) || 0),
        // The field-name switch only matters for openai (Chat Completions); every other format falls back to the default,
        // and the backend re-applies the same normalization; this just keeps the UI from sending contradictory values.
        max_tokens_field: format === "openai" ? toStore(maxTokensField) : "",
        session_header_key: sessionHeaderKey.trim(),
        user_agent: userAgent.trim(),
        retry,
      });
      if (isNew) toast.success(`已创建：${name.trim()}（在其卡片上点击「设为启用」即可启用）`);
      else toast.success(profile?.is_default ? "已保存；当前启用的配置立即生效，无需重启" : "已保存");
      onSaved(String(id));
      onOpenChange(false);
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  let keyPlaceholder = "sk-…";
  if (format === "ollama") {
    keyPlaceholder = "可选——本地 Ollama 服务无需 Key";
  } else if (keyHint) {
    keyPlaceholder = `已设置（${keyHint}）；留空则保持不变`;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:min-w-[420px] data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="px-4">
          <SheetTitle className="flex items-center gap-2">
            {isNew ? "新建模型配置" : `编辑：${profile?.name}`}
            {profile?.is_default && (
              <Badge variant="outline" className="border-amber-400/50 text-amber-500">
                当前启用
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {isNew
              ? "新配置不会自动启用；请在其卡片上点击「设为启用」。"
              : "编辑后点击保存；保存当前启用的配置会对所有智能体立即生效。"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="p-name">名称</Label>
              <Input
                id="p-name"
                placeholder="例如 OpenAI 生产环境"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>格式</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as ProfileFormat)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择格式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI (Chat Completions)</SelectItem>
                  <SelectItem value="openai-responses">OpenAI (Responses API)</SelectItem>
                  <SelectItem value="ollama">Ollama（本地，无需 Key）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-model">模型</Label>
            <div className="flex gap-2">
              <Input
                id="p-model"
                className="font-mono"
                placeholder={format === "ollama" ? "llama3.2" : "claude-opus-4-8"}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              {/* modal: this Popover's content is portaled to <body>, outside the Sheet's scroll lock,
                  so without modal the list renders but cannot scroll. modal lets it hold the topmost scroll lock itself. */}
              <Popover
                open={modelsOpen}
                onOpenChange={(o) => {
                  setModelsOpen(o);
                  if (!o) setModelQuery("");
                }}
                modal
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={loadingModels}
                    onClick={loadModels}
                    title="从 API 加载可用模型"
                  >
                    {loadingModels ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                  </Button>
                </PopoverTrigger>
                {models.length > 0 && (
                  <PopoverContent className="w-80 gap-0 p-0" align="end">
                    <div className="border-b p-1">
                      <Input
                        autoFocus
                        className="h-8 border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                        placeholder={`搜索 ${models.length} 个模型…`}
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        spellCheck={false}
                        aria-label="搜索模型"
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto overscroll-contain p-1">
                      {filteredModels.length === 0 ? (
                        <p className="px-2 py-6 text-center text-muted-foreground text-xs">
                          没有匹配“{modelQuery.trim()}”的模型
                        </p>
                      ) : (
                        filteredModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className="w-full shrink-0 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-accent hover:text-accent-foreground"
                            onClick={() => {
                              setModel(m);
                              setModelsOpen(false);
                            }}
                          >
                            {m}
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                )}
              </Popover>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-base-url">Base URL（可选）</Label>
            <Input
              id="p-base-url"
              className="font-mono"
              placeholder={format === "ollama" ? OLLAMA_DEFAULT_BASE_URL : "https://api.openai.com/v1"}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-proxy">代理（可选）</Label>
            <Input
              id="p-proxy"
              className="font-mono"
              placeholder="socks5://user:pass@127.0.0.1:1080 · http://127.0.0.1:8080"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              仅出站 LLM 请求走此代理；支持 http/https/socks5，可带认证信息（例如 socks5://user:pass@host:port——密码含特殊字符时需进行 URL 编码）。留空则不使用代理（直连）。
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-session-header">自定义会话请求头（可选）</Label>
            <Input
              id="p-session-header"
              className="font-mono"
              placeholder="例如 x-session-id（留空 = 不发送）"
              value={sessionHeaderKey}
              onChange={(e) => setSessionHeaderKey(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              设置请求头名称后，每个请求都会携带该 HTTP 请求头，其值自动填充为<b>当前会话的 session id</b>（对话会话如
              conv-12，执行器如 exp3-worker-i87）。适用于基于 session-id 请求头做提示词缓存 /
              粘性路由的网关；同一会话的多轮之间保持不变，不同会话之间互不相同。留空则不发送。
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-user-agent">自定义 User-Agent（可选）</Label>
            <Input
              id="p-user-agent"
              className="font-mono"
              placeholder="例如 my-app/1.0（留空 = 默认 UA）"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              覆盖每个出站 LLM 请求的 <b>User-Agent</b> 请求头。适用于按
              User-Agent 进行路由或白名单放行的网关。留空则保持默认 User-Agent 不变。
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-api-key">
              {format === "ollama" ? "API Key（Ollama 可选）" : "API Key"}
            </Label>
            <Input
              id="p-api-key"
              type="password"
              placeholder={keyPlaceholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              // A masked field with no autocomplete hint looks like this site's
              // login password: password managers fill it and Save persists the
              // wrong secret over the stored key. new-password keeps them out.
              autoComplete="new-password"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="p-rps">每秒速率限制</Label>
              <Input id="p-rps" type="number" min={0} value={rps} onChange={(e) => setRps(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-rpm">每分钟速率限制</Label>
              <Input id="p-rpm" type="number" min={0} value={rpm} onChange={(e) => setRpm(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-cw">上下文窗口（K）</Label>
              <Input
                id="p-cw"
                type="number"
                min={0}
                max={1000}
                value={cw}
                onChange={(e) => setCw(e.target.value)}
                placeholder="200"
              />
            </div>
          </div>
          <p className="-mt-2 text-muted-foreground text-xs">
            速率限制为 0 表示不限制，由所有智能体共享。上下文窗口单位为 K（千 tokens）；0 = 默认 200K，上限 1000（即 1M）。设置过高会导致压缩永远不会触发。
          </p>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="p-priority" className="text-sm">
                  池优先级
                </Label>
                <p className="text-muted-foreground text-xs">
                  数字越大越优先选用；当前启用的配置无论此值如何始终排在首位。优先级相同的配置轮流领先，自然分摊额度。
                </p>
              </div>
              <Input
                id="p-priority"
                type="number"
                className="w-24 shrink-0"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">不参与池</Label>
                <p className="text-muted-foreground text-xs">
                  启用后，此配置永远不会作为故障转移目标（智能体 / 任务仍可显式固定使用）。适用于专供某个智能体使用、不应因其他智能体的故障而被消耗的昂贵配置。
                </p>
              </div>
              <Switch checked={poolExclude} onCheckedChange={setPoolExclude} aria-label="不参与池" />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">流式输出</Label>
                <p className="text-muted-foreground text-xs">
                  开启（默认）时通过 SSE 流式传输，可实时显示进行中的进度并实时统计 token。关闭时使用真正的非流式请求（stream:false，一次性返回完整响应）——可绕过 SSE 实现有缺陷的网关（空帧 / 丢失 thinking 字段帧），代价是无法看到实时进度。
                </p>
              </div>
              <Switch checked={streaming} onCheckedChange={setStreaming} aria-label="流式输出" />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="p-max-tokens" className="text-sm">
                  输出上限 · max tokens
                </Label>
                <p className="text-muted-foreground text-xs">
                  单次回复最多可生成的 token 数，随每个请求发送。0（默认）= 不发送该字段，由服务端默认值决定。它与上方的「上下文窗口」不是一回事：后者是模型的总容量，仅在本地用于计算压缩阈值。设置过低会导致推理模型在思考中途被截断，连一个字的答案都输出不了。
                </p>
              </div>
              <Input
                id="p-max-tokens"
                type="number"
                min={0}
                className="w-28 shrink-0"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">上限字段名</Label>
                <p className="text-muted-foreground text-xs">{MAX_TOKENS_FIELD_HINTS[format]}</p>
              </div>
              <Select
                value={format === "openai" ? maxTokensField : NONE}
                onValueChange={setMaxTokensField}
                disabled={format !== "openai"}
              >
                <SelectTrigger className="w-56 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_TOKENS_FIELDS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label className="text-sm">思考开关 · thinking.type</Label>
                <p className="text-muted-foreground text-xs">
                  控制是否发送 thinking 字段。不发送 = 省略该字段（兼容 MiniMax 等不支持的模型）；已禁用 = 发送 disabled；已启用 = 发送 enabled。与下方的思考强度相互独立。
                </p>
              </div>
              <Select value={thinkingType} onValueChange={setThinkingType}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_TYPES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">思考强度 · reasoning_effort</Label>
                <p className="text-muted-foreground text-xs">
                  独立的思考强度参数（OpenAI reasoning_effort / Anthropic output_config.effort）。部分 API 没有 thinking 字段，仅通过 effort 激活思考，因此可以单独设置，无需发送思考开关。
                </p>
              </div>
              <Select value={effort} onValueChange={setEffort}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EFFORT_LEVELS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ProfileRetryFields value={retry} onChange={setRetry} />
        </div>

        <div className="flex gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
            {testing ? "测试中…" : "测试连接"}
          </Button>
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving && <Loader2Icon className="animate-spin" />}
            {!saving && (isNew ? <PlusIcon /> : <SaveIcon />)}
            {isNew ? "创建" : "保存"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LLMPage() {
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [pool, setPool] = React.useState<LLMPoolStatus | null>(null);
  const [poolOpen, setPoolOpen] = React.useState(false);
  // The drawer's open flag and its content are stored separately: editing stays put on close, otherwise during the closing animation the title would flash
  // from "Edit X" to "New". editing = null means create.
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LLMProfile | null>(null);
  const openEditor = React.useCallback((p: LLMProfile | null) => {
    setEditing(p);
    setEditOpen(true);
  }, []);

  const loadPool = React.useCallback(async () => {
    try {
      setPool(await api.llmPool());
    } catch {
      /* ignore */
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      setProfiles(await api.llmProfiles());
    } catch {
      /* ignore */
    }
    await loadPool();
  }, [loadPool]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // The health badge on each card reads pool state by profile id.
  const health = React.useMemo(() => {
    const m = new Map<string, LLMPoolMember>();
    for (const c of pool?.chain ?? []) m.set(c.profile_id, c);
    return m;
  }, [pool]);

  async function activate(id: string, name: string) {
    try {
      await api.activateLLMProfile(id);
      toast.success(`已启用：${name}`);
      await load();
    } catch (e) {
      toast.error(`启用失败：${(e as Error).message}`);
    }
  }

  async function remove(p: LLMProfile) {
    if (p.is_default) {
      toast.error("无法删除当前启用的配置");
      return;
    }
    try {
      await api.deleteLLMProfile(p.id);
      toast.success(`已删除：${p.name}`);
      await load();
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    }
  }

  const poolOn = pool?.enabled ?? false;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">LLM</h1>
          <p className="text-muted-foreground text-sm">
            所有智能体共享的格式 / 模型 / 速率限制设置。点击卡片进行编辑；带星标的卡片为当前启用的配置。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPoolOpen(true)}>
            <ZapIcon /> 池设置
            {poolOn && (
              <Badge variant="outline" className="ml-1 border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
                已开启
              </Badge>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openEditor(null)}>
            <PlusIcon /> 创建
          </Button>
        </div>
      </div>

      <Tabs defaultValue="profiles" className="flex-1">
        <TabsList>
          <TabsTrigger value="profiles">模型配置</TabsTrigger>
          <TabsTrigger value="retry">重试与退避</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((p) => {
              const h = healthOf(p, health.get(p.id));
              return (
                // biome-ignore lint/a11y/useSemanticElements: the card contains its own action buttons; a native <button> would nest buttons (invalid HTML)
                <Card
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditor(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEditor(p);
                    }
                  }}
                  className={cn(
                    "cursor-pointer gap-0 py-4 outline-none transition-colors hover:border-foreground/30",
                    p.is_default && "border-amber-400/50 bg-amber-400/5",
                  )}
                >
                  <CardContent className="grid gap-2 px-4">
                    <div className="flex items-start gap-2">
                      <StarIcon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          p.is_default ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-sm">{p.name}</span>
                          <Badge variant="outline" className="uppercase">
                            {p.format}
                          </Badge>
                          <Badge variant="outline" className={cn("ml-auto", h.cls)} title={h.hint}>
                            {h.label}
                          </Badge>
                        </div>
                        <code className="mt-1 block truncate font-mono text-muted-foreground text-xs">{p.model}</code>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-muted-foreground text-xs">
                      {p.api_key_hint && <span>{p.api_key_hint}</span>}
                      <span>
                        {p.rate_per_second}/s · {p.rate_per_minute}/min
                      </span>
                      {p.proxy && <span className="truncate">代理 {p.proxy}</span>}
                      {p.reasoning_effort && (
                        <span>思考 {p.reasoning_effort === "off" ? "关闭" : p.reasoning_effort}</span>
                      )}
                      {/* The two pool-related fields only matter when the pool is on; when it is off they take no space */}
                      {poolOn &&
                        !p.is_default &&
                        (p.pool_exclude ? <span>不参与池</span> : <span>优先级 {p.priority ?? 0}</span>)}
                    </div>

                    <div className="mt-1 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={p.is_default}
                        onClick={(e) => {
                          e.stopPropagation();
                          void activate(p.id, p.name);
                        }}
                      >
                        {p.is_default ? "当前启用" : "设为启用"}
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label="删除配置"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(p);
                        }}
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {profiles.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed p-10 text-center text-muted-foreground text-sm">
                暂无模型配置——点击右上角的「创建」添加第一个。
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="retry" className="mt-4">
          <RetryPolicyPanel />
        </TabsContent>
      </Tabs>

      <ProfileSheet profile={editing} open={editOpen} onOpenChange={setEditOpen} onSaved={() => void load()} />
      <PoolSheet open={poolOpen} onOpenChange={setPoolOpen} pool={pool} onReload={loadPool} />
    </div>
  );
}
