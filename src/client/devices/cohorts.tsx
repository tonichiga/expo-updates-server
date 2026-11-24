"use client";

import { useFormatters } from "@/src/client/i18n/use-formatters";
import { useI18n } from "@/src/client/i18n/provider";
import type { DevicesReport } from "@/src/server/devices/report-types";
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

export function Cohorts({ report }: { report: DevicesReport }) {
  const { t } = useI18n();
  const { date, number, share } = useFormatters();
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardTitle>
          <h2>{t("Когорты установок")}</h2>
        </CardTitle>
        <CardDescription>
          {t(
            "Группы по неделе первого heartbeat. Одна установка — одна запись, переустановка может создать новую.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="adoption">
          <TabsList
            className="mb-4 max-w-full"
            aria-label={t("Когорты установок")}
          >
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
                  <TableHead>{t("Embedded")}</TableHead>
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
                          {share(count, c.installations)}{" "}
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
                                : `color-mix(in srgb, var(--chart-1) ${5 + cell.rate * 30}%, transparent)`,
                          }}
                        >
                          {cell.rate === null
                            ? "—"
                            : share(
                                cell.retainedInstallations ?? 0,
                                cell.eligibleInstallations,
                              )}
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
  );
}
