# Community images are no longer published on Docker Hub. Build a pinned release.
FROM golang:1.24.8-alpine AS builder
RUN apk add --no-cache git ca-certificates
ENV CGO_ENABLED=0 GOMAXPROCS=2
RUN go install -p 2 github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z \
  && go clean -cache -modcache

FROM alpine:3.22
RUN apk add --no-cache ca-certificates curl
COPY --from=builder /go/bin/minio /usr/local/bin/minio
ENTRYPOINT ["minio"]
