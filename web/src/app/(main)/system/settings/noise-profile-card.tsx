"use client";

import * as React from "react";

import { GaugeIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { NoiseProfileName, NoiseStatus } from "@/lib/types";

// Mirrors egress.Profiles in egress/egress.go; the jitter of one send is
// min(Jitter/RPS, 250 ms).
const profiles: { value: NoiseProfileName; label: string; limits: string }[] = [
  { value: "off", label: "关闭", limits: "关闭：不改变请求及其发送时机，也不进行统计。" },
  {
    value: "quiet",
    label: "低噪",
    limits:
      "每主机每秒 2 个请求（突发 4 个），每主机并发 1 个、总并发 8 个，抖动最长 250 ms，同一任务的相同 GET 请求缓存 60 秒，遇到 429/503 最多重试 3 次。",
  },
  {
    value: "balanced",
    label: "均衡",
    limits:
      "每主机每秒 5 个请求（突发 10 个），每主机并发 2 个、总并发 16 个，抖动最长 40 ms，同一任务的相同 GET 请求缓存 30 秒，遇到 429/503 最多重试 3 次。",
  },
  {
    value: "aggressive",
    label: "激进",
    limits:
      "每主机每秒 20 个请求（突发 40 个），每主机并发 4 个、总并发 32 个，抖动最长 5 ms，同一任务的相同 GET 请求缓存 10 秒，遇到 429/503 最多重试 2 次。",
  },
];

// NoiseProfileCard sets the target noise profile and shows the per-host
// counters of the current minute.
export function NoiseProfileCard() {
  const [status, setStatus] = React.useState<NoiseStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(() => {
    setLoading(true);
    api
      .noiseStatus()
      .then(setStatus)
      .catch((e) => toast.error(`加载噪声计数失败：${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, []);
  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const save = (value: NoiseProfileName) => {
    setSaving(true);
    api
      .setSettings({ noise_profile: value })
      .then(() => {
        toast.success(`噪声配置已设为${value}`);
        refresh();
      })
      .catch((e) => toast.error(`保存失败：${(e as Error).message}`))
      .finally(() => setSaving(false));
  };

  const current = profiles.find((p) => p.value === status?.profile) ?? profiles[0];
  return (
    <Card className="mb-4 break-inside-avoid md:mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GaugeIcon className="size-4" />
          目标噪声
        </CardTitle>
        <CardDescription>
          控制云途Agent 自身向目标发送请求（WebFetch、http 自定义工具、enrich 探针）的节奏，并在
          智能体提示词中设置低速低噪指导。启用流量捕获后，使用代理的 Bash 命令（curl、
          wget、python-requests…）也会受到速率和抖动控制：并发、缓存和重试限制仅适用于
          云途Agent 自身的请求。nmap 等原始扫描器以及绕过代理的命令不受节奏控制；这是
          尽力而为的机制，而非安全边界。此设置优先于 ARTEX_NOISE_PROFILE，并对
          下一次请求生效。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="noise-profile" className="text-sm font-normal text-muted-foreground">
            配置
          </Label>
          <Select
            value={status?.profile ?? ""}
            disabled={!status || saving}
            onValueChange={(v) => save(v as NoiseProfileName)}
          >
            <SelectTrigger id="noise-profile" className="w-48 shrink-0">
              <SelectValue placeholder="加载中…" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground text-xs">{current.limits}</p>
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-sm">当前分钟的主机统计</span>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCwIcon data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
            刷新
          </Button>
        </div>
        {status?.hosts.length ? (
          <Table aria-label="各主机噪声计数">
            <TableHeader>
              <TableRow>
                <TableHead>主机</TableHead>
                <TableHead className="text-right">RPM</TableHead>
                <TableHead className="text-right">峰值 RPM</TableHead>
                <TableHead className="text-right">并发（峰值）</TableHead>
                <TableHead className="text-right">已避免的重复请求</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.hosts.map((h) => (
                <TableRow key={h.host}>
                  <TableCell className="max-w-48 truncate font-mono text-xs" title={h.host}>
                    {h.host}
                  </TableCell>
                  <TableCell className="text-right">{h.rpm}</TableCell>
                  <TableCell className="text-right">{h.peak_rpm}</TableCell>
                  <TableCell className="text-right">
                    {h.inflight} ({h.peak_inflight})
                  </TableCell>
                  <TableCell className="text-right">{h.duplicates_avoided}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">
            {status?.profile === "off" ? "关闭时不统计请求。" : "暂无受控请求。"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
