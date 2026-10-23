"use client";
import { useFormatters } from "@/src/client/i18n/use-formatters";
import { useI18n } from "@/src/client/i18n/provider";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VersionAdoptionChart } from "./version-adoption-chart";
import type { DevicesReport } from "@/src/server/devices/report-types";
export const percent = (n: number, total: number) =>
  total ? `${Math.round((n / total) * 100)}%` : "—";
export function useKindNames() {
  const { t } = useI18n();
  return {
    ota: "OTA",
    embedded: "Embedded",
    unknown: t("Не определён"),
  };
}
export function Analytics({ report }: { report: DevicesReport }) {
  const { number, date } = useFormatters();
  const { t } = useI18n();
  const { summary: s } = report;
  const kinds = [
    { label: "OTA", value: s.otaInstallations, color: "var(--chart-1)" },
    {
      label: "Embedded",
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: t("Активные установки"),
            value: number(s.activeInstallations),
            detail: t("Heartbeat за последние {0}", [
              report.filters.days === 1
                ? t("24 часа")
                : t("{0} дней", [report.filters.days]),
            ]),
          },
          {
            label: t("Используют OTA"),
            value: percent(s.otaInstallations, s.activeInstallations),
            detail: t("{0} из {1} установок", [
              number(s.otaInstallations),
              number(s.activeInstallations),
            ]),
          },
          {
            label: t("Встроенная версия"),
            value: number(s.embeddedInstallations),
            detail: t("Сочетаний версий в выборке: {0}", [
              number(s.reportedVersions),
            ]),
          },
          {
            label: t("Аварийный запуск"),
            value: number(s.emergencyInstallations),
            detail: t("Не определён тип запуска: {0}", [
              number(s.unknownInstallations),
            ]),
          },
        ].map((kpi) => (
          <Card key={kpi.label} className="gap-3 py-5 shadow-none">
            <CardHeader className="px-5">
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
                {kpi.value}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 text-xs text-muted-foreground">
              {kpi.detail}
            </CardContent>
          </Card>
        ))}
      </div>
      <VersionAdoptionChart report={report} />
      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card className="min-w-0 shadow-none">
          <CardHeader>
            <CardTitle>{t("Активность установок")}</CardTitle>
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
              className="h-52 w-full"
              aria-label={t("График ежедневных активных и новых установок")}
            >
              <AreaChart
                accessibilityLayer
                data={report.activity}
                margin={{ top: 12, right: 12, left: -24, bottom: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={date}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted-foreground)" }}
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted-foreground)" }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => date(String(value))}
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
                  dot={{ r: 3 }}
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
                  dot={{ r: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>
                <i className="mr-2 inline-block size-2 rounded-full bg-chart-1" />
                {t("Активные")}
              </span>
              <span>
                <i className="mr-2 inline-block size-2 rounded-full bg-chart-2" />
                {t("Новые")}
              </span>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {t("Сбор с ")}
              {date(report.coverage.collectionStartedAt)}{" "}
              {t(
                " · Сегодня — неполный день. До начала сбора данных нет; история хранится 90 дней.",
              )}
            </p>
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {t("Показать значения по дням")}
              </summary>
              <Table className="mt-2">
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
                      <TableCell>{day.activeInstallations ?? "—"}</TableCell>
                      <TableCell>{day.newInstallations ?? "—"}</TableCell>
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
            </details>
          </CardContent>
        </Card>
        <Card className="min-w-0 shadow-none">
          <CardHeader>
            <CardTitle>{t("Тип запуска")}</CardTitle>
            <CardDescription>
              {t("Текущее состояние активных установок")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              className="flex h-3 overflow-hidden rounded-full bg-muted"
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
            <div className="grid grid-cols-3 gap-2">
              {kinds.map((k) => (
                <div key={k.label}>
                  <p className="text-xs text-muted-foreground">
                    <i
                      className="mr-1.5 inline-block size-2 rounded-full"
                      style={{ background: k.color }}
                    />
                    {k.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {number(k.value)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {percent(k.value, s.activeInstallations)}
                    </span>
                  </p>
                </div>
              ))}
            </div>
            {!report.total && (
              <p className="text-sm text-muted-foreground">
                {t("Нет установок с выбранными фильтрами.")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="min-w-0 shadow-none">
        <CardHeader>
          <CardTitle>{t("Когорты установок")}</CardTitle>
          <CardDescription>
            {t(
              "Группы по неделе первого heartbeat. Одна установка — одна запись, переустановка может создать новую.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="adoption">
            <TabsList className="mb-4">
              <TabsTrigger value="adoption">{t("Текущие версии")}</TabsTrigger>
              <TabsTrigger value="retention">{t("Возвращаемость")}</TabsTrigger>
            </TabsList>
            <TabsContent value="adoption">
              <p className="mb-3 text-xs text-muted-foreground">
                {t(
                  "Активные за выбранный период, сгруппированные по неделе первого появления. Проценты внутри каждой когорты.",
                )}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Неделя · UTC")}</TableHead>
                    <TableHead>{t("Установки")}</TableHead>
                    <TableHead>OTA</TableHead>
                    <TableHead>Embedded</TableHead>
                    <TableHead>{t("Не определён")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.adoptionCohorts.map((c) => (
                    <TableRow key={c.weekStart}>
                      <TableCell className="font-medium">
                        {date(c.weekStart)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {number(c.installations)}
                      </TableCell>
                      {[
                        c.otaInstallations,
                        c.embeddedInstallations,
                        c.unknownInstallations,
                      ].map((count, i) => (
                        <TableCell key={i}>
                          <div
                            className="rounded-md px-3 py-2 text-center tabular-nums"
                            style={{
                              background: `color-mix(in srgb, var(--chart-${i + 1}) ${c.installations ? 5 + (count / c.installations) * 20 : 0}%, transparent)`,
                            }}
                          >
                            {percent(count, c.installations)}{" "}
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({number(count)})
                            </span>
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!report.adoptionCohorts.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("Пока нет когорт для этой выборки.")}
                </p>
              )}
            </TabsContent>
            <TabsContent value="retention">
              <p className="mb-3 max-w-4xl text-xs leading-5 text-muted-foreground">
                {t(
                  "Новые установки за последние 90 дней после начала сбора. Фильтры платформы, канала, runtime и типа запуска применяются на момент первого heartbeat. D1/D7 — heartbeat ровно через 1/7 дней, даже если версия изменилась. D0 — исходная когорта (100%); для D1 и дальше неполные дни исключены. «—» означает, что день ещё не наблюдался полностью.",
                )}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Неделя · UTC")}</TableHead>
                    <TableHead>{t("Новые")}</TableHead>
                    {[0, 1, 7, 14, 30].map((d) => (
                      <TableHead key={d} className="text-center">
                        D{d}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.cohorts.map((c) => (
                    <TableRow key={c.weekStart}>
                      <TableCell>{date(c.weekStart)}</TableCell>
                      <TableCell>{number(c.installations)}</TableCell>
                      {c.cells.map((cell) => (
                        <TableCell key={cell.day}>
                          <div
                            className="rounded-md px-2 py-2 text-center tabular-nums"
                            title={
                              cell.rate === null
                                ? t("Нет полностью наблюдаемых дней")
                                : cell.day === 0
                                  ? t(
                                      "D0: исходная когорта, включая сегодняшние установки",
                                    )
                                  : t(
                                      "{0} из {1} установок с полностью наблюдаемым днём",
                                      [
                                        cell.retainedInstallations,
                                        cell.eligibleInstallations,
                                      ],
                                    )
                            }
                            style={{
                              background:
                                cell.rate === null
                                  ? "var(--muted)"
                                  : `color-mix(in srgb, var(--chart-1) ${5 + cell.rate * 25}%, transparent)`,
                            }}
                          >
                            {cell.rate === null
                              ? "—"
                              : `${Math.round(cell.rate * 100)}%`}
                            <span className="block text-[10px] text-muted-foreground">
                              {cell.rate === null
                                ? t("нет данных")
                                : `${cell.retainedInstallations}/${cell.eligibleInstallations}`}
                            </span>
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!report.cohorts.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t(
                    "Возвращаемость появится для новых установок после начала сбора",
                  )}{" "}
                  {date(report.coverage.collectionStartedAt)}.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}
