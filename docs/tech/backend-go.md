# 🦦 Backend (Go, MVC)

> The ZwoSocial API: one Go binary, one Postgres, one Redis. Organised as MVC modules so each feature is self-contained.

---

## Stack

| Layer          | Choice                                    | Notes                                   |
|----------------|-------------------------------------------|-----------------------------------------|
| Language       | Go 1.22+                                  |                                         |
| HTTP router    | `gin-gonic/gin` (or `labstack/echo`)      | One choice, kept consistent             |
| WebSocket      | `nhooyr.io/websocket`                     | Realtime hub backed by Redis pub/sub    |
| Postgres       | `jackc/pgx/v5` + `sqlc` for type-safe SQL | No ORM, explicit queries                |
| Redis          | `redis/go-redis/v9`                       | Streams, cache, pub/sub                 |
| Migrations     | `golang-migrate/migrate`                  | One `.sql` per change                   |
| Validation     | `go-playground/validator/v10`             | Struct-tag based                        |
| Auth           | JWT (`golang-jwt/jwt/v5`) + refresh       | Short-lived access, rotating refresh    |
| E2E            | TweetNaCl (CGO bindings) **or** `crossle/TweetNaCl-protocol-go` | Decision in `backend/auth` PR |
| Object storage | S3-compatible (MinIO in dev)              | Server-side envelope encryption         |
| Logging        | `rs/zerolog`                              | JSON in prod, console in dev            |
| Telemetry      | OpenTelemetry (traces + metrics)          |                                         |
| Test           | std `testing` + `stretchr/testify`        | `testcontainers` for integration        |

---

## Repository layout

```
server/
├── cmd/
│   └── api/
│       └── main.go              # entry point
├── internal/
│   ├── modules/                 # one folder per feature, MVC inside
│   │   ├── auth/
│   │   │   ├── controller.go    # HTTP / WS handlers
│   │   │   ├── service.go       # business logic
│   │   │   ├── repository.go    # DB queries (pgx + sqlc)
│   │   │   ├── model.go         # entities + DTOs
│   │   │   ├── routes.go        # registers routes with the router
│   │   │   └── auth_test.go
│   │   ├── users/
│   │   ├── messages/
│   │   ├── groups/
│   │   ├── channels/
│   │   ├── stories/
│   │   ├── media/
│   │   ├── badges/
│   │   ├── notifications/
│   │   └── ai/                  # Dandara endpoints
│   ├── middleware/              # auth, rate-limit, request-id, recovery
│   ├── realtime/                # WebSocket hub + Redis fan-out
│   ├── platform/
│   │   ├── postgres/            # pool + helpers
│   │   ├── redis/               # client + stream helpers
│   │   ├── signal/              # TweetNaCl wrapper
│   │   ├── crypto/              # envelope encryption, hashing
│   │   ├── storage/             # S3-compatible client
│   │   └── push/                # FCM + APNs
│   ├── config/                  # env → typed config
│   └── server/                  # bootstrap: wires modules to router
├── migrations/                  # *.sql up/down, applied at boot + CI
├── pkg/                         # tiny shared utilities, no business logic
├── deploy/
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── docker-compose.yml   # api + postgres + redis
│   └── k8s/                     # Helm chart later
├── scripts/
└── go.mod
```

### MVC mapping (per module)

| MVC term     | Where                          | Responsibility                                            |
|--------------|--------------------------------|-----------------------------------------------------------|
| Model        | `model.go`, `repository.go`    | Entities (`User`, `Message`), DB access (only pgx here)   |
| View         | JSON via `controller.go`       | DTOs, JSON tags, no business logic                        |
| Controller   | `controller.go`                | HTTP/WS handlers, parse → validate → call service → respond |
| Service      | `service.go`                   | Business rules, orchestration across repos & platform pkgs |
| Routes       | `routes.go`                    | Register the module with the central router               |

A module **never** imports another module's `service.go`/`repository.go`. Cross-module collaboration goes through small, explicit interfaces declared in the consumer (dependency inversion). Shared types live in `pkg/`.

### Example module skeleton (`auth`)

```go
// internal/modules/auth/model.go
package auth

type User struct {
    ID          uuid.UUID
    Username    string
    DisplayName string
    CreatedAt   time.Time
}

type LoginRequest struct {
    Phone string `json:"phone" validate:"required,e164"`
    Code  string `json:"code"  validate:"required,len=6"`
}
```

```go
// internal/modules/auth/repository.go
type Repository struct{ db *pgxpool.Pool }

func (r *Repository) UserByPhoneHash(ctx context.Context, hash []byte) (*User, error) { ... }
```

```go
// internal/modules/auth/service.go
type Service struct {
    repo  *Repository
    redis *redis.Client
    cfg   Config
}

func (s *Service) VerifyCodeAndIssueTokens(ctx context.Context, phone, code string) (Tokens, error) { ... }
```

```go
// internal/modules/auth/controller.go
type Controller struct{ svc *Service; v *validator.Validate }

func (c *Controller) PostVerify(ctx *gin.Context) {
    var req LoginRequest
    if err := ctx.ShouldBindJSON(&req); err != nil { ... }
    if err := c.v.Struct(req); err != nil { ... }
    tokens, err := c.svc.VerifyCodeAndIssueTokens(ctx, req.Phone, req.Code)
    if err != nil { ... }
    ctx.JSON(200, tokens)
}
```

```go
// internal/modules/auth/routes.go
func Register(r *gin.RouterGroup, c *Controller) {
    g := r.Group("/auth")
    g.POST("/start", c.PostStart)
    g.POST("/verify", c.PostVerify)
    g.POST("/refresh", c.PostRefresh)
}
```

### Bootstrap

`internal/server/server.go` wires the platform packages once, then constructs each module's `Repository → Service → Controller → routes`, and starts the HTTP + WS listeners.

```go
func Run(cfg config.Config) error {
    pg     := postgres.Open(cfg.Postgres)
    rdb    := redis.Open(cfg.Redis)
    hub    := realtime.NewHub(rdb)

    authMod     := auth.Build(pg, rdb, cfg)
    usersMod    := users.Build(pg, rdb)
    messagesMod := messages.Build(pg, rdb, hub)
    // ...

    r := gin.New()
    r.Use(middleware.RequestID(), middleware.Recovery(), middleware.RateLimit(rdb))
    api := r.Group("/api")
    auth.Register(api, authMod.Controller)
    users.Register(api, usersMod.Controller)
    messages.Register(api, messagesMod.Controller)
    // ...
    return r.Run(cfg.HTTP.Addr)
}
```

---

## Conventions

- **Errors**: explicit values; wrap with `fmt.Errorf("...: %w", err)`. Public errors are sentinel values (`ErrNotFound`, `ErrUnauthorized`) translated to HTTP status by middleware.
- **Context**: every service / repo method takes `context.Context` first.
- **Time**: UTC everywhere; serialise as RFC 3339.
- **Pagination**: cursor-based (`?cursor=...&limit=...`), never `offset/limit` for hot endpoints.
- **Naming**: `snake_case` for SQL and JSON; `CamelCase` for Go.
- **Tests**: each module has unit tests (services with mocks) and integration tests against a real Postgres/Redis from `testcontainers`.

---

## Running locally

```bash
cd server
cp .env.example .env
docker compose -f deploy/docker/docker-compose.yml up -d postgres redis
go run ./cmd/api
```

`go test ./...` for tests. CI runs unit + integration on every PR into `backend/base`.

---

## Branch & PR flow

- Each backend feature has its own branch from `backend/base` — see [services-and-branches.md](./services-and-branches.md).
- A module is "done" when:
  - Migrations applied cleanly forwards and backwards.
  - HTTP contract documented in `docs/tech/api.md`.
  - Unit + integration tests pass.
  - Security review on the encryption-touching parts.
