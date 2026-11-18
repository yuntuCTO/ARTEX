"use client";

import * as React from "react";

import { CpuIcon, FlaskConicalIcon, KeyboardIcon, RadioTowerIcon, SearchIcon, ShieldAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { CHAT_SEND_MODE_OPTIONS, type ChatSendMode, setChatSendMode, useChatSendMode } from "@/lib/chat-send-mode";
import type { Settings } from "@/lib/types";

import { NoiseProfileCard } from "./noise-profile-card";

export default function SystemSettingsPage() {
  const [trafficCapture, setTrafficCapture] = React.useState(false);
  const [agentTrafficBinding, setAgentTrafficBinding] = React.useState(false);
  const [webSearch, setWebSearch] = React.useState(false);
  const [backend, setBackend] = React.useState("ddgs");
  const [braveKeySet, setBraveKeySet] = React.useState(false);
  const [braveKeyInput, setBraveKeyInput] = React.useState("");
  const [tavilyKeySet, setTavilyKeySet] = React.useState(false);
  const [tavilyKeyInput, setTavilyKeyInput] = React.useState("");
  const [savingTavilyKey, setSavingTavilyKey] = React.useState(false);
  const [keenableKeySet, setKeenableKeySet] = React.useState(false);
  const [keenableKeyInput, setKeenableKeyInput] = React.useState("");
  const [savingKeenableKey, setSavingKeenableKey] = React.useState(false);
  const [proxyInput, setProxyInput] = React.useState("");
  const [savingProxy, setSavingProxy] = React.useState(false);
  const [globalProxyInput, setGlobalProxyInput] = React.useState("");
  const [savingGlobalProxy, setSavingGlobalProxy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savingKey, setSavingKey] = React.useState(false);
  const [pyInterp, setPyInterp] = React.useState("");
  const [workers, setWorkers] = React.useState("3");
  const [savingWorkers, setSavingWorkers] = React.useState(false);
  // Operation constraint injection scope (both on by default).
  const [injectPlanner, setInjectPlanner] = React.useState(true);
  const [injectWorker, setInjectWorker] = React.useState(true);
  // Experimental: noa context compaction (off by default).
  const [noaCompaction, setNoaCompaction] = React.useState(false);
  // Pure frontend preference: bypasses /api/settings, reads and writes localStorage directly.
  const sendMode = useChatSendMode();

  const apply = React.useCallback((s: Settings) => {
    setTrafficCapture(!!s.traffic_capture);
    setAgentTrafficBinding(!!s.agent_traffic_binding);
    setWebSearch(!!s.web_search_enabled);
    setBackend(s.web_search_backend || "ddgs");
    setBraveKeySet(!!s.brave_key_set);
    setTavilyKeySet(!!s.tavily_key_set);
    setKeenableKeySet(!!s.keenable_key_set);
    setProxyInput(s.web_search_proxy ?? "");
    setGlobalProxyInput(s.global_proxy ?? "");
    setPyInterp(s.python_interpreter ?? "");
    setWorkers(String(s.workers ?? 3));
    setInjectPlanner(s.constraints_inject_planner !== false);
    setInjectWorker(s.constraints_inject_worker !== false);
    setNoaCompaction(!!s.noa_compaction);
  }, []);

  const saveWorkers = () => {
    const n = Number(workers);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error("并发数必须是大于 0 的整数");
      return;
    }
    setSavingWorkers(true);
    api
      .setSettings({ workers: n })
      .then((s) => {
        apply(s);
        toast.success("已保存并发执行器智能体数量（对之后启动的任务生效）");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => setSavingWorkers(false));
  };

  const savePython = () => {
    setSaving(true);
    api
      .setSettings({ python_interpreter: pyInterp.trim() })
      .then((s) => {
        apply(s);
        toast.success("已保存 Python 解释器配置");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => setSaving(false));
  };
  const detectPython = () => {
    setSaving(true);
    api
      .detectPython()
      .then((r) => setPyInterp(r.python_interpreter))
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  React.useEffect(() => {
    api
      .settings()
      .then(apply)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [apply]);

  const toggleTraffic = (v: boolean) => {
    setTrafficCapture(v); // optimistic
    setSaving(true);
    api
      .setSettings({ traffic_capture: v })
      .then(apply)
      .catch(() => setTrafficCapture(!v)) // revert on failure
      .finally(() => setSaving(false));
  };

  const toggleInjectPlanner = (v: boolean) => {
    setInjectPlanner(v); // optimistic
    api
      .setSettings({ constraints_inject_planner: v })
      .then(apply)
      .catch(() => setInjectPlanner(!v)); // revert on failure
  };

  const toggleAgentTrafficBinding = (v: boolean) => {
    setAgentTrafficBinding(v);
    setSaving(true);
    api
      .setSettings({ agent_traffic_binding: v })
      .then((s) => {
        apply(s);
        toast.success(v ? "已启用智能体自动流量绑定" : "已禁用智能体自动流量绑定");
      })
      .catch((e) => {
        setAgentTrafficBinding(!v);
        toast.error(`保存失败：${(e as Error).message}`);
      })
      .finally(() => setSaving(false));
  };

  const toggleInjectWorker = (v: boolean) => {
    setInjectWorker(v); // optimistic
    api
      .setSettings({ constraints_inject_worker: v })
      .then(apply)
      .catch(() => setInjectWorker(!v)); // revert on failure
  };

  const toggleNoaCompaction = (v: boolean) => {
    setNoaCompaction(v); // optimistic
    api
      .setSettings({ noa_compaction: v })
      .then((s) => {
        apply(s);
        toast.success(v ? "已启用 noa 上下文压缩（对之后启动的运行生效）" : "已禁用 noa 上下文压缩（已恢复内置压缩）");
      })
      .catch((e) => {
        setNoaCompaction(!v); // revert on failure
        toast.error(`保存失败：${(e as Error).message}`);
      });
  };

  // Persist a web-search patch (enable and/or backend). Optimistic with refetch.
  const saveWebSearch = (patch: Partial<Settings>) => {
    setSaving(true);
    api
      .setSettings(patch)
      .then((s) => {
        apply(s);
        toast.success("已保存网络搜索配置");
      })
      .catch((e) => {
        toast.error("保存失败：" + (e as Error).message);
        api
          .settings()
          .then(apply)
          .catch(() => undefined);
      })
      .finally(() => setSaving(false));
  };

  const saveBraveKey = () => {
    setSavingKey(true);
    api
      .setSettings({ brave_search_api_key: braveKeyInput })
      .then((s) => {
        apply(s);
        setBraveKeyInput("");
        toast.success("已保存 Brave API Key");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => setSavingKey(false));
  };

  const saveTavilyKey = () => {
    setSavingTavilyKey(true);
    api
      .setSettings({ tavily_search_api_key: tavilyKeyInput })
      .then((s) => {
        apply(s);
        setTavilyKeyInput("");
        toast.success("已保存 Tavily API Key");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => setSavingTavilyKey(false));
  };

  const saveKeenableKey = () => {
    setSavingKeenableKey(true);
    api
      .setSettings({ keenable_search_api_key: keenableKeyInput })
      .then((s) => {
        apply(s);
        setKeenableKeyInput("");
        toast.success("已保存 Keenable API Key");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => setSavingKeenableKey(false));
  };

  const saveProxy = () => {
    setSavingProxy(true);
    api
      .setSettings({ web_search_proxy: proxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(proxyInput.trim() ? "已保存出口代理" : "已清除出口代理（直连）");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => setSavingProxy(false));
  };

  const saveGlobalProxy = () => {
    setSavingGlobalProxy(true);
    api
      .setSettings({ global_proxy: globalProxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(globalProxyInput.trim() ? "已保存全局代理" : "已清除全局代理（直连）");
      })
      .catch((e) => toast.error("保存失败：" + (e as Error).message))
      .finally(() => setSavingGlobalProxy(false));
  };

  // Run a real "test" search ("test") against the CURRENT form values (backend +
  // proxy + entered key), falling back to saved values server-side. Toasts result.
  const runTest = () => {
    setTesting(true);
    api
      .testWebSearch({
        web_search_backend: backend,
        web_search_proxy: proxyInput.trim(),
        brave_search_api_key: braveKeyInput,
        tavily_search_api_key: tavilyKeyInput,
        keenable_search_api_key: keenableKeyInput,
      })
      .then((r) => {
        if (r.ok) toast.success(`搜索测试成功 · ${r.backend} 返回了 ${r.count} 条结果`);
        else toast.error("搜索测试失败：" + (r.error || "未知错误"));
      })
      .catch((e) => toast.error("搜索测试失败：" + (e as Error).message))
      .finally(() => setTesting(false));
  };

  // brave-free selected but no key stored and none being entered → tool stays off.
  const braveNeedsKey = webSearch && backend === "brave-free" && !braveKeySet;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">系统设置</h1>
        <p className="text-muted-foreground text-sm">全局运行时开关</p>
      </div>

      {/* Multi-column instead of grid: the web search card is several times taller than the others and
          its height varies with the selected backend (brave/tavily key inputs are conditional). A grid
          would stretch the row to the tallest card and leave blank space beside the others, while columns
          balance-fill by content height. Card spacing uses mb rather than gap — in a multi-column layout
          column-gap only covers the gaps between columns; row spacing must come from the children. */}
      <div className="columns-1 gap-4 md:gap-6 lg:columns-2">
        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              流量捕获
            </CardTitle>
            <CardDescription>
              启用后，每个智能体的 HTTP 流量都会通过录制代理完整保存，并向智能体注入 traffic_search / traffic_get
              工具和代理配置（提示词包含代理说明）。
              <br />
              关闭时（默认）不记录流量：智能体
              <b>不会</b>收到代理配置或流量工具，提示词中也<b>没有</b>代理相关内容。切换后立即重建智能体。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="traffic-capture" className="text-sm font-normal text-muted-foreground">
              {trafficCapture ? "已启用 · 记录流量并注入代理" : "已禁用 · 不记录流量、不注入代理"}
            </Label>
            <Switch
              id="traffic-capture"
              checked={trafficCapture}
              disabled={!loaded || saving}
              onCheckedChange={toggleTraffic}
            />
          </CardContent>
        </Card>

        <NoiseProfileCard />

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              智能体自动流量绑定
            </CardTitle>
            <CardDescription id="agent-traffic-binding-description">
              默认关闭。启用后，创建漏洞时触发的报告智能体会检查现有 HTTP 请求/响应，并在撰写报告前关联匹配的流量。
              <b>读取数据包和额外的工具调用会增加 token 消耗。</b>
              <br />
              对于 TCP、未捕获的流量或无匹配流量的情况，报告仍可正常生成。此开关不影响流量捕获、手动绑定或查看已保存的证据。它对
              下一轮智能体生效；禁用后立即拒绝新的自动绑定。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="agent-traffic-binding" className="text-sm font-normal text-muted-foreground">
              {agentTrafficBinding ? "已启用 · 增加 token 消耗" : "已禁用 · 仍可手动绑定"}
            </Label>
            <Switch
              id="agent-traffic-binding"
              aria-describedby="agent-traffic-binding-description"
              checked={agentTrafficBinding}
              disabled={!loaded || saving}
              onCheckedChange={toggleAgentTrafficBinding}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              全局代理
            </CardTitle>
            <CardDescription>
              所有智能体的<b>目标流量</b>均通过此代理出站（隐藏源 IP / 使用跳板机）。支持 <b>http / https / socks5</b>，可选用{" "}
              <code>user:pass</code> 身份验证。留空表示直连。
              <br />
              启用<b>流量捕获</b>时，它作为录制代理的<b>上游</b>（流量仍完整保存，再通过此代理出站）；关闭捕获时，直接注入
              智能体的 bash / WebFetch 出口。独立于网络搜索代理和 LLM 代理。
              <br />
              <b>备注</b>：<b>关闭捕获</b>时，socks5 依赖各 CLI 工具遵循 <code>ALL_PROXY</code> (curl
              可用；部分工具可能忽略此配置）。如果主要使用 socks5，请启用流量捕获——在该路径中，MITM
              自行建立连接，对工具透明且可靠生效。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="global-proxy" className="text-sm font-normal text-muted-foreground">
              代理地址
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="global-proxy"
                autoComplete="off"
                placeholder="socks5://user:pass@host:1080 或 http://host:port（留空表示直连）"
                value={globalProxyInput}
                disabled={!loaded || savingGlobalProxy}
                onChange={(e) => setGlobalProxyInput(e.target.value)}
              />
              <Button type="button" onClick={saveGlobalProxy} disabled={!loaded || savingGlobalProxy}>
                保存
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {globalProxyInput.trim() ? "已配置 · 所有目标流量均通过此代理出站" : "未配置 · 目标流量直连"}
            </p>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlertIcon className="size-4" />
              操作约束注入
            </CardTitle>
            <CardDescription>
              启用后，每个任务的<b>操作约束</b>（任务概览中“操作约束”下维护的允许/禁止条目）会拼接到对应智能体的
              系统提示词中以限定探索范围（如“仅测试当前端口”“禁止暴力破解”）。
              <br />
              可分别控制是否向<b>规划器</b>和<b>执行器</b>注入
              ；默认均开启。切换立即生效（下一轮读取），无需重建智能体。关闭后，智能体将不再看到这些约束。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="inject-planner" className="text-sm font-normal text-muted-foreground">
                注入规划器{injectPlanner ? " · 已启用" : " · 已禁用"}
              </Label>
              <Switch
                id="inject-planner"
                checked={injectPlanner}
                disabled={!loaded}
                onCheckedChange={toggleInjectPlanner}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="inject-worker" className="text-sm font-normal text-muted-foreground">
                注入执行器{injectWorker ? " · 已启用" : " · 已禁用"}
              </Label>
              <Switch
                id="inject-worker"
                checked={injectWorker}
                disabled={!loaded}
                onCheckedChange={toggleInjectWorker}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConicalIcon className="size-4" />
              实验性功能
            </CardTitle>
            <CardDescription>
              仍在验证中的机制，默认关闭。可能改变智能体行为或影响稳定性；请了解影响后再启用。
              <br />
              <b>noa 上下文压缩</b>：模型主动压缩较长的对话历史（norma v0.4.0）。启用后，平台集成的四类智能体（
              <b>规划器 / 执行器 / 主智能体 / 对话</b>）将切换为 noa 管理的上下文，替代内置压缩，
              压缩前的原始内容会归档到任务工作目录，供后续查看。切换立即生效（对之后启动的运行有效），无需重建智能体；
              禁用后立即恢复内置压缩。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="noa-compaction" className="text-sm font-normal text-muted-foreground">
              noa 上下文压缩{noaCompaction ? " · 已启用" : " · 已禁用"}
            </Label>
            <Switch
              id="noa-compaction"
              checked={noaCompaction}
              disabled={!loaded}
              onCheckedChange={toggleNoaCompaction}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SearchIcon className="size-4" />
              网络搜索
            </CardTitle>
            <CardDescription>
              这是网络搜索的<b>总开关和来源配置</b>。仅在启用后，才能在<b>各智能体配置</b>中单独选择是否启用
              <b>web_search</b> （仅返回标题/链接/摘要，不获取正文；正文由 WebFetch 获取）。网络搜索<b>不</b>经过
              录制代理，且独立于流量捕获。
              <br />
              来源： <b>DuckDuckGo (ddgs)</b> （无需密钥）, <b>Brave（免费版）</b> （需要 Brave API Key）、{" "}
              <b>Tavily</b> （需要 Tavily API Key）或 <b>DeepSeek</b> （复用当前 LLM 配置）。总开关关闭时，
              各智能体的网络搜索开关不可用。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="web-search" className="text-sm font-normal text-muted-foreground">
                {webSearch ? "总开关已启用 · 可在各智能体配置中启用" : "已禁用 · 智能体无法启用网络搜索"}
              </Label>
              <Switch
                id="web-search"
                checked={webSearch}
                disabled={!loaded || saving}
                onCheckedChange={(v) => {
                  setWebSearch(v); // optimistic
                  saveWebSearch({ web_search_enabled: v });
                }}
              />
            </div>

            {webSearch && (
              <div className="flex items-center justify-between gap-4">
                <Label className="text-sm font-normal text-muted-foreground">搜索来源</Label>
                <Select
                  value={backend}
                  disabled={!loaded || saving}
                  onValueChange={(v) => {
                    setBackend(v); // optimistic
                    saveWebSearch({ web_search_backend: v });
                  }}
                >
                  <SelectTrigger className="w-48 shrink-0">
                    <SelectValue placeholder="选择来源" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ddgs">DuckDuckGo（ddgs · 免费，无需密钥）</SelectItem>
                    <SelectItem value="brave-free">Brave（免费版 · 需要密钥）</SelectItem>
                    <SelectItem value="tavily">Tavily（需要密钥）</SelectItem>
                    <SelectItem value="keenable">Keenable（无需密钥，密钥可选）</SelectItem>
                    <SelectItem value="deepseek">DeepSeek（官方）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {webSearch && backend === "deepseek" && (
              <div className="border-border/60 bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
                <p className="text-sm font-medium">DeepSeek 官方网络搜索</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  此来源直接复用<b>当前启用的 LLM 配置</b>。因此
                  <b>仅支持 DeepSeek 官方模型</b>，且配置<b>必须使用 anthropic 协议</b>
                  ——DeepSeek 的 OpenAI 协议端点不支持服务端搜索。切换 LLM 配置后，此来源可能无法使用。
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  与其他来源不同，搜索在 <b>DeepSeek 服务端</b>运行：每次搜索会额外消耗一次模型调用（产生 token
                  费用），搜索请求<b>不经过上方的出口代理</b>，且<b>不记录为流量</b>；结果<b>仅包含标题和链接</b>
                  （无摘要）；需要页面正文时请使用 WebFetch。
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  请自行确认这些条件；系统不会据此阻止操作。可使用下方“测试搜索”按钮执行真实搜索来验证。
                </p>
              </div>
            )}

            {webSearch && backend === "brave-free" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="brave-key" className="text-sm font-normal text-muted-foreground">
                  Brave Search API Key
                  {braveKeySet && <span className="ml-2 text-xs text-emerald-500">已配置</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="brave-key"
                    type="password"
                    autoComplete="off"
                    placeholder={braveKeySet ? "已配置（留空保留）" : "输入 Brave API Key"}
                    value={braveKeyInput}
                    disabled={!loaded || savingKey}
                    onChange={(e) => setBraveKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveBraveKey}
                    disabled={!loaded || savingKey || braveKeyInput.trim() === ""}
                  >
                    保存
                  </Button>
                </div>
                {braveNeedsKey && (
                  <p className="text-xs text-amber-500">
                    已选择 Brave 但尚未配置密钥——保存密钥前，搜索工具将保持禁用。
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  免费版每月约可查询 2,000 次。请前往 https://brave.com/search/api/ 获取密钥。
                </p>
              </div>
            )}

            {webSearch && backend === "tavily" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="tavily-key" className="text-sm font-normal text-muted-foreground">
                  Tavily Search API Key
                  {tavilyKeySet && <span className="ml-2 text-xs text-emerald-500">已配置</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tavily-key"
                    type="password"
                    autoComplete="off"
                    placeholder={tavilyKeySet ? "已配置（留空保留）" : "输入 Tavily API Key（tvly-…）"}
                    value={tavilyKeyInput}
                    disabled={!loaded || savingTavilyKey}
                    onChange={(e) => setTavilyKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveTavilyKey}
                    disabled={!loaded || savingTavilyKey || tavilyKeyInput.trim() === ""}
                  >
                    保存
                  </Button>
                </div>
                {webSearch && backend === "tavily" && !tavilyKeySet && (
                  <p className="text-xs text-amber-500">
                    已选择 Tavily 但尚未配置密钥——保存密钥前，搜索工具将保持禁用。
                  </p>
                )}
                <p className="text-muted-foreground text-xs">请前往 https://tavily.com 注册并获取 API 密钥。</p>
              </div>
            )}

            {webSearch && backend === "keenable" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="keenable-key" className="text-sm font-normal text-muted-foreground">
                  Keenable Search API Key（可选）
                  {keenableKeySet && <span className="ml-2 text-xs text-emerald-500">已配置</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="keenable-key"
                    type="password"
                    autoComplete="off"
                    placeholder={keenableKeySet ? "已配置（留空保留）" : "可选：留空使用无需密钥的端点"}
                    value={keenableKeyInput}
                    disabled={!loaded || savingKeenableKey}
                    onChange={(e) => setKeenableKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveKeenableKey}
                    disabled={!loaded || savingKeenableKey || keenableKeyInput.trim() === ""}
                  >
                    保存
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  查询会离开此实例并发送至 api.keenable.ai。请求携带{" "}
                  <b>X-Keenable-Title: ARTEX</b> 以便服务商识别调用方。未提供密钥时，
                  公共端点按 IP 限流；密钥可提高限额，但后端
                  无需密钥也可工作。
                </p>
              </div>
            )}

            {webSearch && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="ws-proxy" className="text-sm font-normal text-muted-foreground">
                  出口代理（可选）
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ws-proxy"
                    autoComplete="off"
                    placeholder="http://host:port 或 socks5://host:port（留空表示直连）"
                    value={proxyInput}
                    disabled={!loaded || savingProxy}
                    onChange={(e) => setProxyInput(e.target.value)}
                  />
                  <Button type="button" onClick={saveProxy} disabled={!loaded || savingProxy}>
                    保存
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  仅用于访问搜索端点的专用出口代理（VPN/SOCKS 等）。与流量录制 MITM 代理无关；网络受限时可用它访问端点。
                </p>
              </div>
            )}

            {webSearch && (
              <div className="flex items-center justify-between gap-4 border-t pt-4">
                <p className="text-muted-foreground text-xs">
                  使用当前配置（来源 + 代理 + 密钥）执行真实的“测试”搜索，验证是否可用。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runTest}
                  disabled={!loaded || testing}
                  className="shrink-0"
                >
                  {testing ? "测试中…" : "测试搜索"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              自定义脚本 · Python 解释器
            </CardTitle>
            <CardDescription>
              自定义 <b>script</b> 工具使用此解释器运行 Python。启动时自动检测（优先 python3）；可在此输入虚拟环境 /
              特定版本的绝对路径；留空则在运行时自动检测。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                className="font-mono text-sm"
                placeholder="/usr/bin/python3（留空自动检测）"
                value={pyInterp}
                disabled={!loaded || saving}
                onChange={(e) => setPyInterp(e.target.value)}
              />
              <Button variant="outline" onClick={detectPython} disabled={!loaded || saving}>
                重新检测
              </Button>
              <Button onClick={savePython} disabled={!loaded || saving}>
                保存
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CpuIcon className="size-4" />
              工作并发度 · 执行器智能体数量
            </CardTitle>
            <CardDescription>
              每个任务中并发运行的执行器智能体数量（默认 3）。数值越大，并行探测越多，消耗也越高。更改
              <b>对之后启动的任务生效</b>；运行中的任务不受影响。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                className="w-32 font-mono text-sm"
                placeholder="3"
                value={workers}
                disabled={!loaded || savingWorkers}
                onChange={(e) => setWorkers(e.target.value)}
              />
              <Button onClick={saveWorkers} disabled={!loaded || savingWorkers}>
                保存
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyboardIcon className="size-4" />
              对话输入发送快捷键
            </CardTitle>
            <CardDescription>
              对话页面和任务详情中的主智能体对话输入框共用；选择后立即生效，无需保存。
              <br />
              此偏好设置 <b>仅保存在此浏览器中</b>，不会随账户同步；更换浏览器或清除站点数据后需要重新设置。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="chat-send-mode" className="text-sm font-normal text-muted-foreground">
              发送模式
            </Label>
            <Select value={sendMode} onValueChange={(v) => setChatSendMode(v as ChatSendMode)}>
              <SelectTrigger id="chat-send-mode" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_SEND_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
