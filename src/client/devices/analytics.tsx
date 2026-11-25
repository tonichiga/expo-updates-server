"use client";
import { useFormatters } from "@/src/client/i18n/use-formatters";
import { useI18n } from "@/src/client/i18n/provider";

import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  Activity,
  CircleArrowDown,
  Layers3,
  Smartphone,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { DevicesReport } from "@/src/server/devices/report-types";
export function useKindNames() {
  const { t } = useI18n();
  return {
    ota: "OTA",
    embedded: t("Embedded"),
    unknown: t("Не определён"),
  };
}
export function Overview({ report }: { report: DevicesReport }) {
  const { number, date, share } = useFormatters();
  const { t } = useI18n();
  const { summary: s } = report;
  const kinds = [
    { label: "OTA", value: s.otaInstallations, color: "var(--chart-1)" },
    {
      label: t("Embedded"),
      value: s.embeddedInstallations,
      color: "var(--chart-2)",
    },
    {
      label: t("Не определён"),
      value: s.unknownInstallations,
      color: "var(--chart-3)",
    },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border xl:grid-cols-4">
        {[
          {
            icon: Smartphone,
            label: t("Активные установки"),
            value: number(s.activeInstallations),
            detail: t("Heartbeat за последние {0}", [
              report.filters.days === 1
                ? t("24 часа")
                : t("{0} дней", [report.filters.days]),
            ]),
          },
          {
            icon: CircleArrowDown,
            label: t("Используют OTA"),
            value: share(s.otaInstallations, s.activeInstallations),
            detail: t("{0} из {1} установок", [
              number(s.otaInstallations),
              number(s.activeInstallations),
            ]),
          },
          {
            icon: Activity,
            label: t("New installations"),
            value: number(s.newInstallations),
            detail: t("First seen during this period"),
          },
          {
            icon: Layers3,
            label: t("Reported versions"),
            value: number(s.reportedVersions),
            detail: t("Distinct version combinations"),
          },
        ].map((kpi) => (
          <Card key={kpi.label} className="min-w-0 gap-2 rounded-none border-0 py-4 sm:py-5">
            <CardHeader className="gap-3 px-4">
              <CardDescription className="flex items-center justify-between gap-1 text-xs font-medium">
                {kpi.label}
                <kpi.icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </CardDescription>
              <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
                {kpi.value}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 text-xs text-muted-foreground">
              {kpi.detail}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid min-w-0 gap-4">
        <Card className="min-w-0 shadow-none">
          <CardHeader>
            <CardTitle>
              <h2>{t("Активность установок")}</h2>
            </CardTitle>
            <CardDescription>
              {t("Уникальные установки с heartbeat за день · UTC")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                activeInstallations: {
                  label: t("Активные"),
                  color: "var(--chart-1)",
                },
                newInstallations: {
                  label: t("Новые"),
                  color: "var(--chart-2)",
                },
              }}
              className="aspect-auto h-52 w-full sm:h-64 lg:h-72"
              aria-label={t("График ежедневных активных и новых установок")}
            >
              <AreaChart
                accessibilityLayer
                data={report.activity}
                margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={date}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted-foreground)" }}
                  minTickGap={24}
                />
                <YAxis
                  width="auto"
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted-foreground)" }}
                />
                {report.activity
                  .filter((day) => day.coverage === "partial")
                  .map((day) => (
                    <ReferenceLine
                      key={day.date}
                      x={day.date}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="3 4"
                    />
                  ))}
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        const day = report.activity.find(
                          (entry) => entry.date === value,
                        );
                        return day?.coverage === "partial"
                          ? `${date(day.date)} · ${t("Неполный день")}`
                          : date(String(value));
                      }}
                    />
                  }
                />
                <Area
                  type="linear"
                  dataKey="activeInstallations"
                  stroke="var(--color-activeInstallations)"
                  fill="var(--color-activeInstallations)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                  dot={{ r: 2, fill: "var(--color-activeInstallations)" }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Area
                  type="linear"
                  dataKey="newInstallations"
                  stroke="var(--color-newInstallations)"
                  fill="var(--color-newInstallations)"
                  fillOpacity={0.05}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={{ r: 2, fill: "var(--color-newInstallations)" }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>
                <i
                  aria-hidden="true"
                  className="mr-2 inline-block w-4 align-middle border-t-2 border-chart-1"
                />
                {t("Активные")}
              </span>
              <span>
                <i
                  aria-hidden="true"
                  className="mr-2 inline-block w-4 align-middle border-t-2 border-dashed border-chart-2"
                />
                {t("Новые")}
              </span>
              <span>
                <i
                  aria-hidden="true"
                  className="mr-2 inline-block h-3 align-middle border-l border-dashed border-muted-foreground"
                />
                {t("Неполный день")}
              </span>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {t("Сбор с ")}
              {date(report.coverage.collectionStartedAt)}{" "}
              {t(
                " · Сегодня — неполный день. До начала сбора данных нет; история хранится 90 дней.",
              )}
            </p>
            <Collapsible className="group/daily mt-3 text-xs text-muted-foreground">
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="outline">
                  <ChevronDown
                    className="group-data-[state=open]/daily:rotate-180"
                    aria-hidden="true"
                  />
                  {t("Показать значения по дням")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Table
                  className="mt-2"
                  aria-label={t("Показать значения по дням")}
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Дата UTC")}</TableHead>
                      <TableHead>{t("Активные")}</TableHead>
                      <TableHead>{t("Новые")}</TableHead>
                      <TableHead>{t("Покрытие")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.activity.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell>{date(day.date)}</TableCell>
                        <TableCell>
                          {day.activeInstallations === null
                            ? "—"
                            : number(day.activeInstallations)}
                        </TableCell>
                        <TableCell>
                          {day.newInstallations === null
                            ? "—"
                            : number(day.newInstallations)}
                        </TableCell>
                        <TableCell>
                          {day.coverage === "complete"
                            ? t("Полный день")
                            : day.coverage === "partial"
                              ? t("Неполный день")
                              : t("Нет данных")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
        <Card className="min-w-0 shadow-none">
          <CardHeader>
            <CardTitle>
              <h2>{t("Тип запуска")}</h2>
            </CardTitle>
            <CardDescription>
              {t("Текущее состояние активных установок")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="flex h-2 overflow-hidden rounded-sm bg-muted"
              role="img"
              aria-label={kinds.map((k) => `${k.label}: ${k.value}`).join(", ")}
            >
              {kinds.map((k) => (
                <div
                  key={k.label}
                  style={{
                    width: s.activeInstallations
                      ? `${(k.value / s.activeInstallations) * 100}%`
                      : 0,
                    background: k.color,
                  }}
                />
              ))}
            </div>
            <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {kinds.map((k) => (
                <div
                  key={k.label}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 sm:px-4 sm:first:pl-0 sm:last:pr-0"
                >
                  <p className="text-xs text-muted-foreground">
                    <i
                      className="mr-1.5 inline-block size-2 rounded-full"
                      style={{ background: k.color }}
                    />
                    {k.label}
                  </p>
                  <p className="text-base font-semibold tabular-nums">
                    {number(k.value)}{" "}
                    <span className="inline-block min-w-12 text-right text-xs font-normal text-muted-foreground">
                      {share(k.value, s.activeInstallations)}
                    </span>
                  </p>
                </div>
              ))}
            </div>
            <div className={
                "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs " +
                (s.emergencyInstallations ? "border-destructive/40 bg-destructive/10" : "bg-muted/40")
              }>
              <span>{t("Аварийный запуск")}</span>
              <strong
                className={
                  s.emergencyInstallations
                    ? "text-destructive"
                    : "text-foreground"
                }
              >
                {number(s.emergencyInstallations)}
              </strong>
            </div>
            {!report.total && (
              <p className="text-sm text-muted-foreground">
                {t("Нет установок с выбранными фильтрами.")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
