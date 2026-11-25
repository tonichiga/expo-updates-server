"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  History,
  Layers,
  RotateCcw,
  Search,
} from "lucide-react";
import { useConfirmAction } from "@/components/admin/confirm-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChannelBadge, PlatformBadge } from "@/components/admin/release-badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AdminApiError,
  getDistributionHistory,
  restorePreviousRelease,
} from "./admin-api";
import type {
  DistributionHistoryRelease,
  DistributionHistoryResponse,
  DistributionHistoryScope,
} from "./admin-types";
import type { TranslationMessage } from "./i18n/messages";
import { useI18n } from "./i18n/provider";
import { useFormatters } from "./i18n/use-formatters";

function ReleaseLink({ release }: { release: DistributionHistoryRelease }) {
  const { t } = useI18n();
  const { fullDate } = useFormatters();
  return (
    <div className="min-w-0">
      <Link
        href={"/updates/" + release.encodedKey}
        className="inline-flex max-w-full items-baseline gap-1.5 rounded-sm text-sm font-medium hover:text-primary hover:underline focus-visible:outline-ring"
      >
        <span className="truncate">
          {release.comment || release.appVersion || release.updateId}
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-3 shrink-0 self-center text-muted-foreground"
        />
      </Link>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-muted-foreground">
        {release.appVersion && <span>v{release.appVersion}</span>}
        <code>{release.updateId.slice(0, 8)}</code>
        {release.activatedAt && (
          <time dateTime={release.activatedAt} title={t("Activated at")}>
            {fullDate(release.activatedAt)}
          </time>
        )}
      </div>
    </div>
  );
}

const pageSize = 5;
export default function DistributionHistory({
  revision,
  blocked,
  onRestored,
}: {
  revision: number;
  blocked: boolean;
  onRestored: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirmAction();
  const [data, setData] = useState<DistributionHistoryResponse | null>(null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState<TranslationMessage>("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getDistributionHistory(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setLoadError("");
        }
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted)
          setLoadError(err.message || "Unable to load delivery history.");
      });
    return () => controller.abort();
  }, [revision, retry]);

  async function restore(scope: DistributionHistoryScope) {
    const target = scope.previous;
    if (!target || blocked || busy) return;
    const scopeName = [
      scope.channel,
      scope.platform,
      scope.runtimeVersion,
    ].join(" / ");
    if (
      !(await confirm(
        t("Restore release"),
        t("Resume public delivery of {0} in {1}?", [
          target.comment || target.updateId,
          scopeName,
        ]),
        true,
      ))
    )
      return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await restorePreviousRelease(target.updateId, scope.revision);
      setNotice({
        key: "Restored {0} in {1}.",
        values: [target.appVersion || target.updateId.slice(0, 8), scopeName],
      });
      onRestored();
    } catch (err) {
      setActionError(
        err instanceof AdminApiError && err.status === 409
          ? "Delivery changed. Review the refreshed scope before restoring."
          : err instanceof Error
            ? err.message
            : "Could not restore release.",
      );
      setRetry((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const query = filter.trim().toLowerCase();
  const scopes = (data?.scopes || []).filter((scope) =>
    [scope.channel, scope.runtimeVersion, scope.platform].some((v) =>
      v.toLowerCase().includes(query),
    ),
  );
  const pages = Math.ceil(scopes.length / pageSize);
  const visiblePage = Math.min(page, Math.max(0, pages - 1));
  return (
    <Card
      aria-labelledby="public-distribution"
      className="min-w-0 gap-0 overflow-hidden py-0"
    >
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="space-y-1">
          <CardTitle
            id="public-distribution"
            className="flex items-center gap-2 text-base"
          >
            <History className="size-4 text-primary" aria-hidden="true" />
            {t("Public delivery")}
          </CardTitle>
          <CardDescription>
            {t(
              "Current and previous releases served to all devices in each scope.",
            )}
          </CardDescription>
        </div>
        {(data?.scopes.length ?? 0) > 0 && (
          <InputGroup className="w-full sm:w-52">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t("Find a delivery scope")}
              placeholder={t("Find a delivery scope")}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            />
          </InputGroup>
        )}
      </CardHeader>
      {loadError && (
        <Alert variant="destructive" className="rounded-none">
          <AlertDescription>
            {t(loadError)}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRetry((n) => n + 1)}
            >
              {t("Retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {actionError && (
        <Alert variant="destructive" className="rounded-none">
          <AlertDescription>{t(actionError)}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="border-t px-5 py-2 text-sm">
          {t(notice)}
        </p>
      )}
      {!data && !loadError && <Skeleton className="mx-5 mb-4 h-16" />}
      {data && !scopes.length && (
        <Empty className="gap-2 rounded-none border-t border-solid p-4 md:p-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Layers />
            </EmptyMedia>
            <EmptyTitle className="text-sm">
              {t(
                query ? "No matching scopes" : "No public release history yet",
              )}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                query
                  ? "Try another runtime, channel or platform."
                  : "Manually activate a release for all devices to start its history.",
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {scopes.length > 0 && (
        <div>
          <div
            aria-hidden="true"
            className="hidden grid-cols-[1fr_1.15fr_1.15fr_auto] gap-4 border-y bg-muted/45 px-5 py-2 text-xs font-medium text-muted-foreground lg:grid"
          >
            <span>{t("Delivery scope")}</span>
            <span>{t("Currently serving")}</span>
            <span>{t("Previous public release")}</span>
            <span className="w-24" />
          </div>
          {scopes
            .slice(visiblePage * pageSize, (visiblePage + 1) * pageSize)
            .map((scope) => (
              <section
                key={JSON.stringify([
                  scope.runtimeVersion,
                  scope.platform,
                  scope.channel,
                ])}
                aria-label={[
                  scope.channel,
                  scope.platform,
                  scope.runtimeVersion,
                ].join(" / ")}
                className="grid min-w-0 gap-3 border-t px-4 py-3.5 sm:px-5 lg:grid-cols-[1fr_1.15fr_1.15fr_auto] lg:items-center lg:gap-4 lg:first-of-type:border-t-0"
              >
                <div className="min-w-0">
                  <ChannelBadge channel={scope.channel} />
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <PlatformBadge platform={scope.platform} />
                    {t("Runtime {0}", [scope.runtimeVersion])}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-xs text-muted-foreground lg:sr-only">
                    {t("Currently serving")}
                  </div>
                  {scope.current ? (
                    <ReleaseLink release={scope.current} />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CircleOff className="size-3.5" />
                      {t("No active release")}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-xs text-muted-foreground lg:sr-only">
                    {t("Previous public release")}
                  </div>
                  {scope.previous ? (
                    <ReleaseLink release={scope.previous} />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t("No previous release")}
                    </span>
                  )}
                </div>
                <div className="lg:min-w-24 lg:text-right">
                  {scope.previous && data?.canWrite && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={blocked || busy || !!loadError}
                      onClick={() => void restore(scope)}
                    >
                      <RotateCcw />
                      {t("Restore")}
                    </Button>
                  )}
                </div>
              </section>
            ))}
          {pages > 1 && (
            <div className="flex items-center justify-end gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
              <span>{t("Page {0} of {1}", [visiblePage + 1, pages])}</span>
              <Button
                variant="outline"
                size="icon"
                disabled={!visiblePage}
                aria-label={t("Назад")}
                onClick={() => setPage(visiblePage - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={visiblePage + 1 >= pages}
                aria-label={t("Вперёд")}
                onClick={() => setPage(visiblePage + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
