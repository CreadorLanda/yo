# 🦦 Backend (Go, MVC)

> A API do ZwoSocial: um único binário Go, um Postgres, um Redis. Organizado como módulos MVC para que cada funcionalidade seja autocontida.

---

## Stack

| Camada         | Escolha                                   | Notas                                   |
|----------------|-------------------------------------------|-----------------------------------------|
| Linguagem      | Go 1.22+                                  |                                         |
| Router HTTP    | `gin-gonic/gin` (ou `labstack/echo`)      | Uma escolha, mantida consistente        |
| WebSocket      | `nhooyr.io/websocket`                     | Hub realtime apoiado em Redis pub/sub   |
| Postgres       | `jackc/pgx/v5` + `sqlc` para SQL tipado   | Sem ORM, queries explícitas             |
| Redis          | `redis/go-redis/v9`                       | Streams, cache, pub/sub                 |
| Migrações      | `golang-migrate/migrate`                  | Um `.sql` por mudança                   |
| Validação      | `go-playground/validator/v10`             | Por struct tags                         |
| Auth           | JWT (`golang-jwt/jwt/v5`) + refresh       | Access curto, refresh rotativo          |
| E2E            | TweetNaCl (CGO) **ou** `crossle/TweetNaCl-protocol-go` | Decisão no PR `backend/auth` |
| Object storage | Compatível S3 (MinIO em dev)              | Envelope encryption server-side         |
| Logging        | `rs/zerolog`                              | JSON em prod, console em dev            |
| Telemetria     | OpenTelemetry (traces + métricas)         |                                         |
| Testes         | `testing` da std + `stretchr/testify`     | `testcontainers` para integração        |

---

## Layout do repositório

```
server/
├── cmd/
│   └── api/
│       └── main.go              # entry point
├── internal/
│   ├── modules/                 # uma pasta por funcionalidade, MVC dentro
│   │   ├── auth/
│   │   │   ├── controller.go    # handlers HTTP / WS
│   │   │   ├── service.go       # lógica de negócio
│   │   │   ├── repository.go    # queries (pgx + sqlc)
│   │   │   ├── model.go         # entidades + DTOs
│   │   │   ├── routes.go        # liga ao router
│   │   │   └── auth_test.go
│   │   ├── users/
│   │   ├── messages/
│   │   ├── groups/
│   │   ├── channels/
│   │   ├── stories/
│   │   ├── media/
│   │   ├── badges/
│   │   ├── notifications/
│   │   ├── ai/                  # endpoints da Dandara
│   ├── middleware/              # auth, rate-limit, request-id, recovery
│   ├── realtime/                # hub WebSocket + fan-out Redis
│   ├── platform/
│   │   ├── postgres/            # pool + helpers
│   │   ├── redis/               # cliente + helpers de streams
│   │   ├── signal/              # wrapper TweetNaCl
│   │   ├── crypto/              # envelope encryption, hashing
│   │   ├── storage/             # cliente S3-compatível
│   │   └── push/                # FCM + APNs
│   ├── config/                  # env → config tipada
│   └── server/                  # bootstrap: liga módulos ao router
├── migrations/                  # *.sql up/down, aplicadas no boot + CI
├── pkg/                         # utilitários partilhados pequenos, sem lógica
├── deploy/
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── docker-compose.yml   # api + postgres + redis
│   └── k8s/                     # Helm chart mais tarde
├── scripts/
└── go.mod
```

### Mapeamento MVC (por módulo)

| Termo MVC    | Onde                           | Responsabilidade                                          |
|--------------|--------------------------------|-----------------------------------------------------------|
| Model        | `model.go`, `repository.go`    | Entidades (`User`, `Message`), acesso à BD (só pgx aqui)  |
| View         | JSON via `controller.go`       | DTOs, tags JSON, sem lógica de negócio                    |
| Controller   | `controller.go`                | Handlers HTTP/WS: parse → validate → service → response   |
| Service      | `service.go`                   | Regras de negócio, orquestração entre repos & platform    |
| Routes       | `routes.go`                    | Regista o módulo no router central                        |

Um módulo **nunca** importa `service.go`/`repository.go` de outro módulo. A colaboração entre módulos faz-se por interfaces pequenas e explícitas declaradas no consumidor (inversão de dependência). Tipos partilhados vivem em `pkg/`.

### Esqueleto de módulo (`auth`)

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

`internal/server/server.go` liga os packages de platform uma vez e depois constrói, para cada módulo, `Repository → Service → Controller → routes`, e arranca os listeners HTTP + WS.

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

## Convenções

- **Erros**: valores explícitos; envolver com `fmt.Errorf("...: %w", err)`. Erros públicos são sentinelas (`ErrNotFound`, `ErrUnauthorized`) traduzidos para HTTP status por middleware.
- **Context**: cada método de service/repo recebe `context.Context` primeiro.
- **Tempo**: UTC sempre; serializar em RFC 3339.
- **Paginação**: por cursor (`?cursor=...&limit=...`), nunca `offset/limit` em endpoints quentes.
- **Naming**: `snake_case` em SQL e JSON; `CamelCase` em Go.
- **Testes**: cada módulo tem testes unitários (serviços com mocks) e testes de integração contra Postgres/Redis reais via `testcontainers`.

---

## Correr localmente

```bash
cd server
cp .env.example .env
docker compose -f deploy/docker/docker-compose.yml up -d postgres redis
go run ./cmd/api
```

`go test ./...` para testes. CI corre unit + integração em cada PR para `backend/base`.

---

## Fluxo de branch / PR

- Cada feature de backend tem a sua branch a partir de `backend/base` — ver [services-and-branches.md](./services-and-branches.md).
- Um módulo está "concluído" quando:
  - Migrações aplicam-se limpas (para a frente e para trás).
  - Contrato HTTP documentado em `docs/tech/api.md`.
  - Testes unitários e de integração passam.
  - Revisão de segurança nas partes que tocam encriptação.
